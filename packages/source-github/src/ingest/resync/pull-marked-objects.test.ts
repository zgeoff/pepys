import { expect, mock, onTestFinished, test } from 'bun:test';
import { createHmac, generateKeyPairSync } from 'node:crypto';
import { createIngest, createMemoryFactLog, noSenderProof } from '@pepys/ingest';
import { checkDeployment, defineDeployment } from '@pepys/kit';
import type { StreamName, StreamOffset } from '@pepys/kit';
import { createTestStore } from '@pepys/testing';
import { toTagged } from '@zgeoff/std';
import { HttpResponse, http } from 'msw';
import invariant from 'tiny-invariant';
import { mockNetwork } from '../../../../../scripts/test-preload/mock-network.ts';
import { githubPlugin } from '../../github-plugin.ts';
import { githubSource } from '../../github-source.ts';
import {
  GITHUB_API_URL,
  githubPullRequests,
  githubReleases,
  githubRepositories,
} from '../../test-utils/github-api-handlers.ts';
import { toAppliedFact } from '../../test-utils/to-applied-fact.ts';

async function setupTest() {
  const streams = githubSource.families.map((family) => toTagged<StreamName>(family.stream));
  const log = createMemoryFactLog(streams);

  const deployment = checkDeployment(
    defineDeployment({ name: 'harbour', plugins: [githubPlugin] }),
  );

  invariant(deployment.ok, 'the GitHub deployment passes the check');

  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });

  const ingest = createIngest({
    deployment: deployment.value,
    secrets: {
      PEPYS_GITHUB_WEBHOOK_SECRET: 'harbour-webhook-secret',
      PEPYS_GITHUB_APP_ID: '4242',
      PEPYS_GITHUB_APP_PRIVATE_KEY: keys.privateKey.export({ type: 'pkcs1', format: 'pem' }),
    },
    log,
    senderProof: noSenderProof,
    appendRetry: { maxAttempts: 2, retryDelayMs: 0 },
    now: () => 1_800_000_000_000,
  });

  const store = await createTestStore({ plugins: [githubPlugin] });

  onTestFinished(() => store[Symbol.asyncDispose]());

  const readStored = async (stream: string) => {
    const read = await log.read(toTagged<StreamName>(stream), toTagged<StreamOffset>(0), 100);

    invariant(read.ok, 'the stream exists');

    return read.value;
  };

  return {
    ingest,
    store,
    send: (event: string, deliveryID: string, body: string) =>
      ingest.handleRequest(
        new Request('http://ingest.test/webhook/github', {
          method: 'POST',
          headers: {
            'x-hub-signature-256': `sha256=${createHmac('sha256', 'harbour-webhook-secret').update(body).digest('hex')}`,
            'x-github-event': event,
            'x-github-delivery': deliveryID,
          },
          body,
        }),
      ),
    readTypes: async (stream: string) => {
      const stored = await readStored(stream);

      return stored.map((item): string => item.fact.type);
    },
    applyStored: async (stream: string) => {
      for (const item of await readStored(stream)) {
        await store.apply(githubSource, [
          toAppliedFact({
            stream: toTagged<StreamName>(stream),
            fact: item.fact,
            blobs: [],
          }),
        ]);
      }
    },
  };
}

test('it sets the release row to the API state after a draft, a publish and the draft again in one second', async () => {
  const ctx = await setupTest();

  const release = {
    id: 5,
    tag_name: 'v2.0.0',
    target_commitish: 'beef002',
    name: 'Harbour 2.0.0',
    url: 'https://api.github.com/repos/acme/harbour/releases/5',
    html_url: 'https://github.example/acme/harbour/releases/tag/v2.0.0',
    prerelease: false,
    created_at: '2026-10-03T09:00:00Z',
    updated_at: '2026-10-03T09:00:00Z',
  };

  const repository = { id: 902, full_name: 'acme/harbour' };
  const draft = { ...release, draft: true, published_at: null };
  const published = { ...release, draft: false, published_at: '2026-10-03T09:00:00Z' };

  await githubRepositories.create({ id: 902, fullName: 'acme/harbour', installationID: 31 });
  await githubReleases.create({ repository: 'acme/harbour', id: 5, record: draft });

  await ctx.send(
    'release',
    'd-1',
    JSON.stringify({ action: 'created', release: draft, repository }),
  );

  await ctx.send(
    'release',
    'd-2',
    JSON.stringify({ action: 'published', release: published, repository }),
  );

  await ctx.send(
    'release',
    'd-3',
    JSON.stringify({ action: 'created', release: draft, repository }),
  );

  const run = await ctx.ingest.runPull('github', 'resync', null);

  await ctx.applyStored('facts.github.release');

  const rows = await ctx.store.readRows('github_release');

  expect({ run, rows }).toStrictEqual({
    run: { kind: 'stored', stored: 1, cursor: 'resynced', isDone: true },
    rows: [expect.objectContaining({ id: 'github:release:5', is_draft: true, published_at: null })],
  });
});

test('it keeps the published row when a stranger replays the draft and the API answers published', async () => {
  const ctx = await setupTest();

  const release = {
    id: 6,
    tag_name: 'v2.1.0',
    target_commitish: 'beef003',
    name: 'Harbour 2.1.0',
    url: 'https://api.github.com/repos/acme/harbour/releases/6',
    html_url: 'https://github.example/acme/harbour/releases/tag/v2.1.0',
    prerelease: false,
    created_at: '2026-10-04T09:00:00Z',
    updated_at: '2026-10-04T09:00:00Z',
  };

  const repository = { id: 902, full_name: 'acme/harbour' };
  const draft = { ...release, draft: true, published_at: null };
  const published = { ...release, draft: false, published_at: '2026-10-04T09:00:00Z' };

  await githubRepositories.create({ id: 902, fullName: 'acme/harbour', installationID: 31 });
  await githubReleases.create({ repository: 'acme/harbour', id: 6, record: published });

  await ctx.send(
    'release',
    'd-1',
    JSON.stringify({ action: 'created', release: draft, repository }),
  );

  await ctx.send(
    'release',
    'd-2',
    JSON.stringify({ action: 'published', release: published, repository }),
  );

  await ctx.send(
    'release',
    'd-stranger',
    JSON.stringify({ action: 'created', release: draft, repository }),
  );

  await ctx.ingest.runPull('github', 'resync', null);
  await ctx.applyStored('facts.github.release');

  const rows = await ctx.store.readRows('github_release');

  expect(rows).toStrictEqual([
    expect.objectContaining({
      id: 'github:release:6',
      is_draft: false,
      published_at: '2026-10-04T09:00:00Z',
    }),
  ]);
});

test('it writes nothing and drops the mark of a release that the API answers 404 for', async () => {
  const ctx = await setupTest();

  const release = {
    id: 7,
    tag_name: 'v2.2.0',
    target_commitish: 'beef004',
    name: 'Harbour 2.2.0',
    url: 'https://api.github.com/repos/acme/harbour/releases/7',
    html_url: 'https://github.example/acme/harbour/releases/tag/v2.2.0',
    draft: false,
    prerelease: false,
    created_at: '2026-10-05T09:00:00Z',
    updated_at: '2026-10-05T09:00:00Z',
  };

  const repository = { id: 902, full_name: 'acme/harbour' };

  await githubRepositories.create({ id: 902, fullName: 'acme/harbour', installationID: 31 });

  await ctx.send(
    'release',
    'd-1',
    JSON.stringify({ action: 'published', release: { ...release, name: 'One' }, repository }),
  );

  await ctx.send(
    'release',
    'd-2',
    JSON.stringify({ action: 'edited', release: { ...release, name: 'Two' }, repository }),
  );

  const run = await ctx.ingest.runPull('github', 'resync', null);
  const types = await ctx.readTypes('facts.github.release');

  const marks: unknown = ctx.ingest.resyncMarks.list('github');

  expect({ run, types, marks }).toStrictEqual({
    run: { kind: 'stored', stored: 0, cursor: 'resynced', isDone: true },
    types: ['github.release.published', 'github.release.edited'],
    marks: [],
  });
});

test('it sets the pull request row to the API state after two bodies with one time', async () => {
  const ctx = await setupTest();

  const pullRequest = {
    id: 91,
    number: 6,
    state: 'open',
    url: 'https://api.github.com/repos/acme/harbour/pulls/6',
    html_url: 'https://github.example/acme/harbour/pull/6',
    user: { id: 4401, type: 'User' },
    base: { repo: { id: 902 } },
    created_at: '2026-10-07T09:00:00Z',
    updated_at: '2026-10-07T09:00:00Z',
  };

  await githubRepositories.create({ id: 902, fullName: 'acme/harbour', installationID: 31 });

  await githubPullRequests.create({
    repository: 'acme/harbour',
    number: 6,
    record: { ...pullRequest, title: 'Tidy the dock list' },
  });

  await ctx.send(
    'pull_request',
    'd-1',
    JSON.stringify({
      action: 'opened',
      pull_request: { ...pullRequest, title: 'Tidy the dock list' },
    }),
  );

  await ctx.send(
    'pull_request',
    'd-2',
    JSON.stringify({ action: 'edited', pull_request: { ...pullRequest, title: 'Tidy docks' } }),
  );

  await ctx.ingest.runPull('github', 'resync', null);
  await ctx.applyStored('facts.github.pull_request');

  const rows = await ctx.store.readRows('github_pull_request');

  expect(rows).toStrictEqual([
    expect.objectContaining({ id: 'github:pull_request:91', title: 'Tidy the dock list' }),
  ]);
});

test('it sets the pull request row to the unchanged API state again after a later tied body', async () => {
  const ctx = await setupTest();

  const pullRequest = {
    id: 92,
    number: 7,
    state: 'open',
    url: 'https://api.github.com/repos/acme/harbour/pulls/7',
    html_url: 'https://github.example/acme/harbour/pull/7',
    user: { id: 4401, type: 'User' },
    base: { repo: { id: 902 } },
    created_at: '2026-10-08T09:00:00Z',
    updated_at: '2026-10-08T09:00:00Z',
  };

  await githubRepositories.create({ id: 902, fullName: 'acme/harbour', installationID: 31 });

  await githubPullRequests.create({
    repository: 'acme/harbour',
    number: 7,
    record: { ...pullRequest, title: 'Sort the buoy log' },
  });

  await ctx.send(
    'pull_request',
    'd-1',
    JSON.stringify({
      action: 'opened',
      pull_request: { ...pullRequest, title: 'Sort the buoy log' },
    }),
  );

  await ctx.send(
    'pull_request',
    'd-2',
    JSON.stringify({ action: 'edited', pull_request: { ...pullRequest, title: 'Sort buoys' } }),
  );

  await ctx.ingest.runPull('github', 'resync', null);
  await ctx.applyStored('facts.github.pull_request');

  await ctx.send(
    'pull_request',
    'd-3',
    JSON.stringify({ action: 'edited', pull_request: { ...pullRequest, title: 'Buoy log' } }),
  );

  await ctx.applyStored('facts.github.pull_request');

  const marks = ctx.ingest.resyncMarks.list('github');

  await ctx.ingest.runPull('github', 'resync', null);
  await ctx.applyStored('facts.github.pull_request');

  const rows = await ctx.store.readRows('github_pull_request');

  expect({ marks, rows }).toStrictEqual({
    marks: [expect.objectContaining({ entity: 'github:pull_request:92' })],
    rows: [expect.objectContaining({ id: 'github:pull_request:92', title: 'Sort the buoy log' })],
  });
});

test('it calls no API and stores nothing when no entity is marked', async () => {
  const ctx = await setupTest();

  const called = mock<(url: string) => void>();

  mockNetwork.use(
    http.all(`${GITHUB_API_URL}/*`, (info) => {
      called(info.request.url);

      return HttpResponse.json({ message: 'unexpected' }, { status: 500 });
    }),
  );

  const run = await ctx.ingest.runPull('github', 'resync', null);

  expect({ run, calls: called.mock.calls }).toStrictEqual({
    run: { kind: 'stored', stored: 0, cursor: 'resynced', isDone: true },
    calls: [],
  });
});

test('it keeps every mark when the API is unavailable', async () => {
  const ctx = await setupTest();

  const release = {
    id: 8,
    tag_name: 'v2.3.0',
    target_commitish: 'beef005',
    url: 'https://api.github.com/repos/acme/harbour/releases/8',
    html_url: 'https://github.example/acme/harbour/releases/tag/v2.3.0',
    draft: false,
    created_at: '2026-10-06T09:00:00Z',
    updated_at: '2026-10-06T09:00:00Z',
  };

  const repository = { id: 902, full_name: 'acme/harbour' };

  mockNetwork.use(
    http.get(`${GITHUB_API_URL}/repos/:owner/:name/installation`, () =>
      HttpResponse.json({ message: 'Service Unavailable' }, { status: 503 }),
    ),
  );

  await ctx.send('release', 'd-1', JSON.stringify({ action: 'published', release, repository }));

  await ctx.send(
    'release',
    'd-2',
    JSON.stringify({ action: 'edited', release: { ...release, name: 'Renamed' }, repository }),
  );

  const run = await ctx.ingest.runPull('github', 'resync', null);

  const marks: unknown = ctx.ingest.resyncMarks.list('github');

  expect({ run, marks }).toStrictEqual({
    run: { kind: 'unavailable', retryAfterMs: 60_000 },
    marks: [
      {
        entity: 'github:release:8',
        locator: '/repos/acme/harbour/releases/8',
        lastBodyDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      },
    ],
  });
});

test('it signs the App JWT with issue and expiry times from the ingest clock', async () => {
  const ctx = await setupTest();

  const authorizations: (string | null)[] = [];

  await githubRepositories.create({ id: 902, fullName: 'acme/harbour', installationID: 31 });

  const release = {
    id: 7,
    tag_name: 'v2.2.0',
    target_commitish: 'beef004',
    name: 'Harbour 2.2.0',
    url: 'https://api.github.com/repos/acme/harbour/releases/7',
    html_url: 'https://github.example/acme/harbour/releases/tag/v2.2.0',
    draft: false,
    prerelease: false,
    created_at: '2026-10-05T09:00:00Z',
    updated_at: '2026-10-05T09:00:00Z',
  };

  const repository = { id: 902, full_name: 'acme/harbour' };

  await ctx.send(
    'release',
    'd-1',
    JSON.stringify({ action: 'published', release: { ...release, name: 'One' }, repository }),
  );

  await ctx.send(
    'release',
    'd-2',
    JSON.stringify({ action: 'edited', release: { ...release, name: 'Two' }, repository }),
  );

  mockNetwork.use(
    http.get(`${GITHUB_API_URL}/repos/acme/harbour/installation`, (info) => {
      authorizations.push(info.request.headers.get('authorization'));

      return HttpResponse.json({ message: 'Not Found' }, { status: 404 });
    }),
  );

  await ctx.ingest.runPull('github', 'resync', null);

  const [, claims] = (authorizations[0] ?? '').replace(/^Bearer /u, '').split('.');

  expect(JSON.parse(Buffer.from(claims ?? '', 'base64url').toString('utf8'))).toStrictEqual({
    iat: 1_799_999_940,
    exp: 1_800_000_540,
    iss: '4242',
  });
});

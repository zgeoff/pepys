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
  githubReleases,
  githubRepositories,
} from '../../mocks/github-api-handlers.ts';
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
      PEPYS_GITHUB_APP_PRIVATE_KEY: keys.privateKey
        .export({ type: 'pkcs1', format: 'pem' })
        .toString(),
    },
    log,
    senderProof: noSenderProof,
    appendRetry: { maxAttempts: 2, retryDelayMs: 0 },
    now: () => 0,
  });

  const store = await createTestStore({ plugins: [githubPlugin] });

  onTestFinished(() => store[Symbol.asyncDispose]());

  const readStored = async () => {
    const read = await log.read(
      toTagged<StreamName>('facts.github.release'),
      toTagged<StreamOffset>(0),
      100,
    );

    invariant(read.ok, 'the stream exists');

    return read.value;
  };

  return {
    ingest,
    store,
    send: (deliveryID: string, body: string) =>
      ingest.handleRequest(
        new Request('http://ingest.test/webhook/github', {
          method: 'POST',
          headers: {
            'x-hub-signature-256': `sha256=${createHmac('sha256', 'harbour-webhook-secret').update(body).digest('hex')}`,
            'x-github-event': 'release',
            'x-github-delivery': deliveryID,
          },
          body,
        }),
      ),
    readTypes: async () => {
      const stored = await readStored();

      return stored.map((item): string => item.fact.type);
    },
    applyStored: async () => {
      for (const item of await readStored()) {
        await store.apply(githubSource, [
          toAppliedFact({
            stream: toTagged<StreamName>('facts.github.release'),
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
  await ctx.send('d-1', JSON.stringify({ action: 'created', release: draft, repository }));
  await ctx.send('d-2', JSON.stringify({ action: 'published', release: published, repository }));
  await ctx.send('d-3', JSON.stringify({ action: 'created', release: draft, repository }));

  const run = await ctx.ingest.runPull('github', 'resync', null);

  await ctx.applyStored();

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
  await ctx.send('d-1', JSON.stringify({ action: 'created', release: draft, repository }));
  await ctx.send('d-2', JSON.stringify({ action: 'published', release: published, repository }));
  await ctx.send('d-stranger', JSON.stringify({ action: 'created', release: draft, repository }));
  await ctx.ingest.runPull('github', 'resync', null);
  await ctx.applyStored();

  const rows = await ctx.store.readRows('github_release');

  expect(rows).toStrictEqual([
    expect.objectContaining({
      id: 'github:release:6',
      is_draft: false,
      published_at: '2026-10-04T09:00:00Z',
    }),
  ]);
});

test('it writes a deleted fact for a marked release that the API no longer has', async () => {
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
    'd-1',
    JSON.stringify({ action: 'published', release: { ...release, name: 'One' }, repository }),
  );

  await ctx.send(
    'd-2',
    JSON.stringify({ action: 'edited', release: { ...release, name: 'Two' }, repository }),
  );

  await ctx.ingest.runPull('github', 'resync', null);

  const types = await ctx.readTypes();

  expect(types).toStrictEqual([
    'github.release.published',
    'github.release.edited',
    'github.release.deleted',
  ]);
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

  await ctx.send('d-1', JSON.stringify({ action: 'published', release, repository }));

  await ctx.send(
    'd-2',
    JSON.stringify({ action: 'edited', release: { ...release, name: 'Renamed' }, repository }),
  );

  const run = await ctx.ingest.runPull('github', 'resync', null);

  const marks: unknown = ctx.ingest.resyncMarks.list('github');

  expect({ run, marks }).toStrictEqual({
    run: { kind: 'unavailable', retryAfterMs: 60_000 },
    marks: [{ entity: 'github:release:8', locator: '/repos/acme/harbour/releases/8' }],
  });
});

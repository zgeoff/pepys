import { expect, onTestFinished, spyOn, test } from 'bun:test';
import { createHmac, generateKeyPairSync } from 'node:crypto';
import { createIngest, createMemoryFactLog, noSenderProof } from '@pepys/ingest';
import { checkDeployment, defineDeployment } from '@pepys/kit';
import type { StreamName, StreamOffset } from '@pepys/kit';
import { applyInBothOrders, createTestStore } from '@pepys/testing';
import { toTagged } from '@zgeoff/std';
import invariant from 'tiny-invariant';
import { githubPlugin } from './github-plugin.ts';
import { githubSource } from './github-source.ts';
import { buildBotPullRequestBody } from './test-utils/build-bot-pull-request-body.ts';
import { buildPushedFact } from './test-utils/build-pushed-fact.ts';
import { githubDeliveries } from './test-utils/github-api-handlers.ts';
import { toAppliedFact } from './test-utils/to-applied-fact.ts';

async function setupTest() {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const streams = githubSource.families.map((family) => toTagged<StreamName>(family.stream));
  const log = createMemoryFactLog(streams);

  const deployment = checkDeployment(
    defineDeployment({ name: 'harbour', plugins: [githubPlugin] }),
  );

  invariant(deployment.ok, 'the GitHub deployment passes the check');

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
    now: () => 0,
  });

  const store = await createTestStore({ plugins: [githubPlugin] });

  onTestFinished(() => store[Symbol.asyncDispose]());

  const readStored = async (stream: string) => {
    const read = await log.read(toTagged<StreamName>(stream), toTagged<StreamOffset>(0), 100);

    invariant(read.ok, 'the stream exists');

    return read.value;
  };

  return {
    store,
    runRecovery: (cursor: string | null) => ingest.runPull('github', 'recovery', cursor),
    send: (event: string, deliveryID: string, body: string, secret = 'harbour-webhook-secret') =>
      ingest.handleRequest(
        new Request('http://ingest.test/webhook/github', {
          method: 'POST',
          headers: {
            'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
            'x-github-event': event,
            'x-github-delivery': deliveryID,
          },
          body,
        }),
      ),
    readIDs: async (stream: string) => {
      const stored = await readStored(stream);

      return stored.map((item): string => item.fact.id);
    },
    applyStored: async (stream: string) => {
      for (const item of await readStored(stream)) {
        await store.apply(githubSource, [
          toAppliedFact({ stream: toTagged<StreamName>(stream), fact: item.fact, blobs: [] }),
        ]);
      }
    },
  };
}

test('it stores a signed pull request webhook on the GitHub route under a body hash ID', async () => {
  const ctx = await setupTest();

  const body = JSON.stringify({
    action: 'opened',
    pull_request: { id: 77, updated_at: '2026-10-02T10:30:00Z' },
  });

  const response = await ctx.send('pull_request', 'd-7', body);
  const answerBody: unknown = await response.json();

  const answer = { status: response.status, body: answerBody };

  const ids = await ctx.readIDs('facts.github.pull_request');

  expect({ answer, ids }).toStrictEqual({
    answer: { status: 200, body: { status: 'stored', stored: 1 } },
    ids: [expect.stringMatching(/^webhook:github:h-[0-9a-f]{64}$/u)],
  });
});

test('it refuses a webhook signed with another secret and stores nothing', async () => {
  const ctx = await setupTest();

  const body = JSON.stringify({
    action: 'opened',
    pull_request: { id: 77, updated_at: '2026-10-02T10:30:00Z' },
  });

  const response = await ctx.send('pull_request', 'd-7', body, 'some-other-secret');
  const ids = await ctx.readIDs('facts.github.pull_request');

  expect({ status: response.status, ids }).toStrictEqual({ status: 401, ids: [] });
});

test('it refuses a webhook body over 1 MiB and stores nothing', async () => {
  const ctx = await setupTest();

  const body = JSON.stringify({
    action: 'opened',
    pull_request: { id: 77, updated_at: '2026-10-02T10:30:00Z', body: 'x'.repeat(1_100_000) },
  });

  const response = await ctx.send('pull_request', 'd-7', body);
  const ids = await ctx.readIDs('facts.github.pull_request');

  expect({ status: response.status, ids }).toStrictEqual({ status: 413, ids: [] });
});

test('it stores the other failed deliveries of a recovery pull and moves past one over 1 MiB', async () => {
  const ctx = await setupTest();

  await githubDeliveries.create({
    id: '401',
    statusCode: 413,
    event: 'pull_request',
    payload: {
      action: 'opened',
      pull_request: { id: 82, updated_at: '2026-10-04T08:00:00Z', body: 'x'.repeat(1_100_000) },
    },
  });

  await githubDeliveries.create({
    id: '402',
    statusCode: 503,
    event: 'pull_request',
    payload: { action: 'opened', pull_request: { id: 83, updated_at: '2026-10-04T08:01:00Z' } },
  });

  const errorLog = spyOn(console, 'error').mockImplementation(() => {});

  onTestFinished(() => {
    errorLog.mockRestore();
  });

  const run = await ctx.runRecovery(null);
  const ids = await ctx.readIDs('facts.github.pull_request');

  expect({ run, ids, logged: errorLog.mock.calls }).toStrictEqual({
    run: { kind: 'stored', stored: 1, cursor: '402', isDone: true },
    ids: [expect.stringMatching(/^webhook:github:h-[0-9a-f]{64}$/u)],
    logged: [['the GitHub delivery 401 is larger than one append of the log takes']],
  });
});

test('it keeps the second of two release updates with one time when the first body comes again', async () => {
  const ctx = await setupTest();

  const release = {
    id: 5,
    tag_name: 'v1.2.0',
    target_commitish: 'c0ffee1',
    name: 'Harbour 1.2.0',
    url: 'https://api.github.com/repos/acme/harbour/releases/5',
    html_url: 'https://github.example/acme/harbour/releases/tag/v1.2.0',
    prerelease: false,
    created_at: '2026-10-01T09:00:00Z',
    updated_at: '2026-10-01T09:00:00Z',
  };

  const repository = { id: 902, full_name: 'acme/harbour' };

  const draft = {
    action: 'created',
    release: { ...release, draft: true, published_at: null },
    repository,
  };

  const published = {
    action: 'published',
    release: { ...release, draft: false, published_at: '2026-10-01T09:00:00Z' },
    repository,
  };

  await ctx.send('release', 'd-1', JSON.stringify(draft));
  await ctx.send('release', 'd-2', JSON.stringify(published));
  await ctx.send('release', 'd-3', JSON.stringify(draft, null, 2));
  await ctx.applyStored('facts.github.release');

  const rows = await ctx.store.readRows('github_release');

  expect(rows).toStrictEqual([
    {
      id: 'github:release:5',
      repository_id: 'github:repo:902',
      repository_full_name: 'acme/harbour',
      tag_name: 'v1.2.0',
      target_commitish: 'c0ffee1',
      name: 'Harbour 1.2.0',
      url: 'https://github.example/acme/harbour/releases/tag/v1.2.0',
      is_draft: false,
      is_prerelease: false,
      created_at: '2026-10-01T09:00:00Z',
      published_at: '2026-10-01T09:00:00Z',
      updated_at: '2026-10-01T09:00:00Z',
      deleted_at: null,
    },
  ]);
});

test('it reads the bumps of the stored body back from its own row, so a late older body changes nothing', async () => {
  const ctx = await setupTest();

  const first = buildBotPullRequestBody('2026-10-01T09:00:00Z', 'v1.2.0');
  const newest = buildBotPullRequestBody('2026-10-01T10:00:00Z', 'v1.3.0');
  const late = buildBotPullRequestBody('2026-10-01T08:00:00Z', 'v1.1.0');

  await ctx.send('pull_request', 'd-1', JSON.stringify(first));
  await ctx.send('pull_request', 'd-2', JSON.stringify(newest));
  await ctx.send('pull_request', 'd-3', JSON.stringify(late));
  await ctx.applyStored('facts.github.pull_request');

  const bumps = await ctx.store.readRows('github_release_bump');

  expect(bumps).toStrictEqual([
    {
      pull_request_id: 'github:pull_request:88',
      release_repository: 'acme/kit',
      release_tag: 'v1.3.0',
    },
  ]);
});

test('it gives the same deploy and commit rows for its facts in either order', async () => {
  const report = await applyInBothOrders({
    plugins: [githubPlugin],
    source: githubSource,
    facts: [
      buildPushedFact('refs/heads/main', 'c0ffee1', '2026-10-01T08:00:00.000Z'),
      buildPushedFact('refs/tags/deployed/production', 'c0ffee1', '2026-10-01T09:00:00.000Z'),
      buildPushedFact('refs/tags/deployed/production', 'c0ffee1', '2026-10-01T10:00:00.000Z'),
      buildPushedFact('refs/tags/deployed/production/api', 'c0ffee1', '2026-10-01T09:30:00.000Z'),
      {
        type: 'github.deployment.status_created',
        event: 'status-1',
        entity: 'github:deployment:31',
        at: '2026-10-01T09:10:00Z',
        payload: {
          deployment_status: { state: 'success' },
          deployment: { id: 31, environment: 'production', sha: 'c0ffee1' },
          repository: { id: 902 },
        },
      },
    ],
  });

  expect(report.isSame).toBeTrue();
});

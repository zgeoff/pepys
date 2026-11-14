import { expect, test } from 'bun:test';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { createLogger } from '@pepys/kit';
import { mockNetwork } from '@pepys/mock-network';
import { HttpResponse, delay, http } from 'msw';
import { z } from 'zod';
import { GITHUB_API_URL, githubDeliveries } from '../../test-utils/github-api-handlers.ts';
import { pullFailedDeliveries } from './pull-failed-deliveries.ts';

function setupTest() {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const lines: string[] = [];

  const stopping = new AbortController();

  const context = {
    env: {
      PEPYS_GITHUB_APP_ID: '4242',
      PEPYS_GITHUB_APP_PRIVATE_KEY: keys.privateKey.export({ type: 'pkcs1', format: 'pem' }),
    },
    now: () => 1_800_000_000_000,
    marks: [],
    log: createLogger({ write: (line) => lines.push(line) }),
    signal: stopping.signal,
  };

  return {
    pull: (cursor: string | null) => pullFailedDeliveries(cursor, context),
    stop: () => {
      stopping.abort();
    },
    readLogged: () => lines.map((line): unknown => JSON.parse(line)),
  };
}

test('it answers unavailable when GitHub cannot be reached, and logs the failed call', async () => {
  const ctx = setupTest();

  mockNetwork.use(http.get(`${GITHUB_API_URL}/app/hook/deliveries`, () => HttpResponse.error()));

  const pulled: unknown = await ctx.pull(null);

  expect(pulled).toStrictEqual({ kind: 'unavailable', retryAfterMs: 60_000 });

  expect(ctx.readLogged()).toStrictEqual([
    {
      level: 'error',
      message: `a GitHub API call to ${GITHUB_API_URL}/app/hook/deliveries?per_page=100 failed`,
      detail: expect.any(Object),
    },
  ]);
});

test('it ends a call GitHub has not answered when ingest stops, and logs no failure', async () => {
  const ctx = setupTest();
  const reached = Promise.withResolvers<void>();

  mockNetwork.use(
    http.get(`${GITHUB_API_URL}/app/hook/deliveries`, async () => {
      reached.resolve();

      await delay('infinite');

      return HttpResponse.json([]);
    }),
  );

  const pulling = ctx.pull(null);

  await reached.promise;

  ctx.stop();

  const pulled: unknown = await pulling;

  expect(pulled).toStrictEqual({ kind: 'unavailable', retryAfterMs: 60_000 });
  expect(ctx.readLogged()).toStrictEqual([]);
});

test('it pulls each failed delivery as a fact with the ID its webhook gives', async () => {
  const ctx = setupTest();

  const payload = {
    action: 'opened',
    pull_request: { id: 77, updated_at: '2026-10-02T10:30:00Z' },
  };

  const hash = createHash('sha256')
    .update('{"action":"opened","pull_request":{"id":77,"updated_at":"2026-10-02T10:30:00Z"}}')
    .digest('hex');

  await githubDeliveries.create({ id: '101', statusCode: 503, event: 'pull_request', payload });

  await githubDeliveries.create({
    id: '102',
    statusCode: 200,
    event: 'pull_request',
    payload: { action: 'closed', pull_request: { id: 78, updated_at: '2026-10-02T10:31:00Z' } },
  });

  const pulled: unknown = await ctx.pull(null);

  expect(pulled).toStrictEqual({
    kind: 'batch',
    batch: {
      facts: [
        {
          stream: 'facts.github.pull_request',
          fact: expect.objectContaining({
            id: `webhook:github:h-${hash}`,
            type: 'github.pull_request.opened',
          }),
          blobs: [],
        },
      ],
    },
    cursor: '102',
    isDone: true,
  });
});

test('it reads every page and skips an event that has no rule', async () => {
  const ctx = setupTest();

  await githubDeliveries.create({
    id: '201',
    statusCode: 0,
    event: 'release',
    payload: {
      action: 'published',
      release: { id: 5, created_at: '2026-10-01T09:00:00Z' },
    },
  });

  await githubDeliveries.create({ id: '202', statusCode: 200, event: 'push' });
  await githubDeliveries.create({ id: '203', statusCode: 502, event: 'star' });

  const pulled: unknown = await ctx.pull(null);

  expect(pulled).toStrictEqual({
    kind: 'batch',
    batch: {
      facts: [
        {
          stream: 'facts.github.release',
          fact: expect.objectContaining({ type: 'github.release.published' }),
          blobs: [],
        },
      ],
    },
    cursor: '203',
    isDone: true,
  });
});

test('it leaves out the deliveries at or before the cursor', async () => {
  const ctx = setupTest();

  await githubDeliveries.create({
    id: '301',
    statusCode: 503,
    event: 'pull_request',
    payload: { action: 'opened', pull_request: { id: 79, updated_at: '2026-10-02T10:30:00Z' } },
  });

  const pulled: unknown = await ctx.pull('301');

  expect(pulled).toStrictEqual({
    kind: 'batch',
    batch: { facts: [] },
    cursor: '301',
    isDone: true,
  });
});

test('it recovers a failed delivery whose ID is above 2^53 and keeps the highest ID exact', async () => {
  const ctx = setupTest();

  await githubDeliveries.create({
    id: '6815230947712500481',
    statusCode: 504,
    event: 'pull_request',
    payload: { action: 'opened', pull_request: { id: 81, updated_at: '2026-10-03T08:00:00Z' } },
  });

  await githubDeliveries.create({ id: '6815230947712500483', statusCode: 200, event: 'push' });

  const pulled: unknown = await ctx.pull(null);

  expect(pulled).toStrictEqual({
    kind: 'batch',
    batch: {
      facts: [
        {
          stream: 'facts.github.pull_request',
          fact: expect.objectContaining({ type: 'github.pull_request.opened' }),
          blobs: [],
        },
      ],
    },
    cursor: '6815230947712500483',
    isDone: true,
  });
});

test('it leaves out a delivery at or before a cursor above 2^53 that differs only past 2^53', async () => {
  const ctx = setupTest();

  await githubDeliveries.create({
    id: '6815230947712500481',
    statusCode: 504,
    event: 'pull_request',
    payload: { action: 'opened', pull_request: { id: 82, updated_at: '2026-10-03T08:00:00Z' } },
  });

  await githubDeliveries.create({
    id: '6815230947712500483',
    statusCode: 504,
    event: 'release',
    payload: { action: 'published', release: { id: 6, created_at: '2026-10-03T08:01:00Z' } },
  });

  const pulled: unknown = await ctx.pull('6815230947712500482');

  expect(pulled).toStrictEqual({
    kind: 'batch',
    batch: {
      facts: [
        {
          stream: 'facts.github.release',
          fact: expect.objectContaining({ type: 'github.release.published' }),
          blobs: [],
        },
      ],
    },
    cursor: '6815230947712500483',
    isDone: true,
  });
});

test('it rejects the pull when the App private key cannot sign', async () => {
  const pulled = await pullFailedDeliveries(null, {
    env: { PEPYS_GITHUB_APP_ID: '4242', PEPYS_GITHUB_APP_PRIVATE_KEY: 'not a key' },
    now: () => 1_800_000_000_000,
    marks: [],
    log: createLogger({ write: () => {} }),
    signal: new AbortController().signal,
  });

  expect(pulled).toStrictEqual({
    kind: 'rejected',
    reason: 'the GitHub App private key cannot sign a token',
  });
});

test('it reads a page that GitHub serves after the JWT of the first page expired', async () => {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  let nowMs = 1_800_000_000_000;

  mockNetwork.use(
    http.get(`${GITHUB_API_URL}/app/hook/deliveries`, (info) => {
      const url = new URL(info.request.url);

      const [, claims] = (info.request.headers.get('authorization') ?? '').split('.');
      const expiry: unknown = JSON.parse(Buffer.from(claims ?? '', 'base64url').toString('utf8'));

      if (!z.object({ exp: z.number().gt(nowMs / 1000) }).safeParse(expiry).success) {
        return HttpResponse.json({ message: 'Bad credentials' }, { status: 401 });
      }

      if (url.searchParams.has('cursor')) {
        return new HttpResponse('[{"id":401,"status_code":200,"event":"push"}]');
      }

      // the first page takes GitHub eleven minutes
      nowMs += 660_000;

      return new HttpResponse('[{"id":402,"status_code":200,"event":"push"}]', {
        headers: { link: `<${GITHUB_API_URL}/app/hook/deliveries?cursor=1>; rel="next"` },
      });
    }),
  );

  const pulled = await pullFailedDeliveries(null, {
    env: {
      PEPYS_GITHUB_APP_ID: '4242',
      PEPYS_GITHUB_APP_PRIVATE_KEY: keys.privateKey.export({ type: 'pkcs1', format: 'pem' }),
    },
    now: () => nowMs,
    marks: [],
    log: createLogger({ write: () => {} }),
    signal: new AbortController().signal,
  });

  expect(pulled).toStrictEqual({
    kind: 'batch',
    batch: { facts: [] },
    cursor: '402',
    isDone: true,
  });
});

test('it signs the App JWT with issue and expiry times from the context clock', async () => {
  const ctx = setupTest();
  const authorizations: (string | null)[] = [];

  mockNetwork.use(
    http.get(`${GITHUB_API_URL}/app/hook/deliveries`, (info) => {
      authorizations.push(info.request.headers.get('authorization'));

      return HttpResponse.json([]);
    }),
  );

  await ctx.pull(null);

  const [, claims] = (authorizations[0] ?? '').replace(/^Bearer /u, '').split('.');

  expect(JSON.parse(Buffer.from(claims ?? '', 'base64url').toString('utf8'))).toStrictEqual({
    iat: 1_799_999_940,
    exp: 1_800_000_540,
    iss: '4242',
  });
});

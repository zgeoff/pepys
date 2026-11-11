import { expect, test } from 'bun:test';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { githubDeliveries } from '../../mocks/github-api-handlers.ts';
import { pullFailedDeliveries } from './pull-failed-deliveries.ts';

function setupTest() {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });

  const context = {
    env: {
      PEPYS_GITHUB_APP_ID: '4242',
      PEPYS_GITHUB_APP_PRIVATE_KEY: keys.privateKey
        .export({ type: 'pkcs1', format: 'pem' })
        .toString(),
    },
    marks: [],
  };

  return { pull: (cursor: string | null) => pullFailedDeliveries(cursor, context) };
}

test('it pulls each failed delivery as a fact with the ID its webhook gives', async () => {
  const ctx = setupTest();

  const payload = {
    action: 'opened',
    pull_request: { id: 77, updated_at: '2026-10-02T10:30:00Z' },
  };

  const hash = createHash('sha256')
    .update('{"action":"opened","pull_request":{"id":77,"updated_at":"2026-10-02T10:30:00Z"}}')
    .digest('hex');

  await githubDeliveries.create({ id: 101, statusCode: 503, event: 'pull_request', payload });

  await githubDeliveries.create({
    id: 102,
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
    id: 201,
    statusCode: 0,
    event: 'release',
    payload: {
      action: 'published',
      release: { id: 5, created_at: '2026-10-01T09:00:00Z' },
    },
  });

  await githubDeliveries.create({ id: 202, statusCode: 200, event: 'push' });
  await githubDeliveries.create({ id: 203, statusCode: 502, event: 'star' });

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
    id: 301,
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

test('it rejects the pull when the App private key cannot sign', async () => {
  const pulled = await pullFailedDeliveries(null, {
    env: { PEPYS_GITHUB_APP_ID: '4242', PEPYS_GITHUB_APP_PRIVATE_KEY: 'not a key' },
    marks: [],
  });

  expect(pulled).toStrictEqual({
    kind: 'rejected',
    reason: 'the GitHub App private key cannot sign a token',
  });
});

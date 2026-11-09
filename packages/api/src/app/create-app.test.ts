import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm, symlink, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import { githubPullRequestConsumer } from '@pepys/source-github';
import { createStoreReader } from '../store-reader/create-store-reader.ts';
import { openConsumerDatabase } from '../store-reader/open-consumer-database.ts';
import { seedConsumerVersion } from '../test-utils/seed-consumer-version.ts';
import { createApp } from './create-app.ts';
import type { APIClient } from './create-router.ts';

async function setupTest() {
  const stack = new AsyncDisposableStack();

  onTestFinished(() => stack.disposeAsync());

  const storeDirectory = await mkdtemp(join(tmpdir(), 'pepys-api-'));

  stack.defer(() => rm(storeDirectory, { recursive: true, force: true }));

  const store = createStoreReader({ storeDirectory, openDatabase: openConsumerDatabase });

  stack.defer(() => store.close());

  const app = createApp({ store, consumers: [githubPullRequestConsumer] });

  const link = new RPCLink({
    url: 'http://pepys.test/rpc',

    // RPCLink fixes this option name
    // oxlint-disable-next-line zgeoff/function-verb
    fetch: (request) => app.handle(request),
  });

  const client: APIClient = createORPCClient(link);

  return { consumerDirectory: join(storeDirectory, 'github_pull_request'), client };
}

test('it serves get_entity from the contract: the entity view row, the full row and the aliases', async () => {
  const ctx = await setupTest();

  const versionDirectory = join(ctx.consumerDirectory, 'v1');

  await seedConsumerVersion({
    versionDirectory,
    row: {
      id: 'github:pr:5',
      number: 5,
      repository_id: 'github:repo:2',
      title: 'Chart the shoals',
      state: 'open',
      is_draft: 1,
      is_merged: 0,
      author_id: 'github:user:77',
      url: 'https://github.example/acme/harbour/pull/5',
      merge_commit_sha: null,
      created_at: '2026-10-01T08:00:00Z',
      updated_at: '2026-10-01T09:00:00Z',
      closed_at: null,
      merged_at: null,
      payload: '{"labels":["map"]}',
    },
  });

  await symlink(versionDirectory, join(ctx.consumerDirectory, 'current'));

  const result = await ctx.client.get_entity({ id: 'github:pr:5' });

  expect(result).toStrictEqual({
    entity: {
      id: 'github:pr:5',
      kind: 'pr',
      title: 'Chart the shoals',
      url: 'https://github.example/acme/harbour/pull/5',
      actor: 'github:user:77',
      updated_at: '2026-10-01T09:00:00Z',
    },
    row: {
      id: 'github:pr:5',
      number: 5,
      repository_id: 'github:repo:2',
      title: 'Chart the shoals',
      state: 'open',
      is_draft: true,
      is_merged: false,
      author_id: 'github:user:77',
      url: 'https://github.example/acme/harbour/pull/5',
      merge_commit_sha: null,
      created_at: '2026-10-01T08:00:00Z',
      updated_at: '2026-10-01T09:00:00Z',
      closed_at: null,
      merged_at: null,
      payload: { labels: ['map'] },
    },
    aliases: [],
  });
});

test('it answers UNPROCESSABLE_CONTENT with HTTP 422 for an assert link with no evidence', async () => {
  const ctx = await setupTest();

  expect(
    ctx.client.assert_link({
      requestID: 'request-1',
      type: 'mentions',
      from: 'gmail:msg:17',
      to: { kind: 'entity', id: 'github:issue:412' },
      confidence: 0.4,
      evidence: '',
    }),
  ).rejects.toMatchObject({ code: 'UNPROCESSABLE_CONTENT', status: 422, defined: true });
});

test('it answers BAD_REQUEST for an assert link whose only fault is its confidence', async () => {
  const ctx = await setupTest();

  expect(
    ctx.client.assert_link({
      requestID: 'request-1',
      type: 'mentions',
      from: 'gmail:msg:17',
      to: { kind: 'entity', id: 'github:issue:412' },
      confidence: 1.2,
      evidence: 'the email quotes the issue title',
    }),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST', status: 400 });
});

test('it answers NOT_IMPLEMENTED for a contract procedure with no handler yet', async () => {
  const ctx = await setupTest();

  expect(
    ctx.client.neighbourhood({
      id: 'github:pr:5',
      depthLimit: 1,
      linkTypes: null,
      includeHubs: false,
      minimumConfidence: 0.5,
    }),
  ).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED', status: 501 });
});

test('it answers NOT_FOUND for an entity the consumer does not hold', async () => {
  const ctx = await setupTest();

  const versionDirectory = join(ctx.consumerDirectory, 'v1');

  await seedConsumerVersion({
    versionDirectory,
    row: {
      id: 'github:pr:5',
      number: 5,
      repository_id: 'github:repo:2',
      title: 'Chart the shoals',
      state: 'open',
      is_draft: 0,
      is_merged: 0,
      author_id: null,
      url: 'https://github.example/acme/harbour/pull/5',
      merge_commit_sha: null,
      created_at: '2026-10-01T08:00:00Z',
      updated_at: '2026-10-01T09:00:00Z',
      closed_at: null,
      merged_at: null,
      payload: '{}',
    },
  });

  await symlink(versionDirectory, join(ctx.consumerDirectory, 'current'));

  expect(ctx.client.get_entity({ id: 'github:pr:6' })).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
});

test('it answers NOT_FOUND for an entity kind no consumer serves', async () => {
  const ctx = await setupTest();

  expect(ctx.client.get_entity({ id: 'github:issue:5' })).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
});

test('it answers NOT_FOUND while the consumer has no current version', async () => {
  const ctx = await setupTest();

  expect(ctx.client.get_entity({ id: 'github:pr:5' })).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
});

test('it rejects an ID that is not an entity ID', async () => {
  const ctx = await setupTest();

  expect(ctx.client.get_entity({ id: 'harbour' })).rejects.toMatchObject({
    code: 'BAD_REQUEST',
  });
});

test('it serves the new row after the current link is repointed', async () => {
  const ctx = await setupTest();

  const firstDirectory = join(ctx.consumerDirectory, 'v1');
  const secondDirectory = join(ctx.consumerDirectory, 'v2');
  const currentLink = join(ctx.consumerDirectory, 'current');

  await seedConsumerVersion({
    versionDirectory: firstDirectory,
    row: {
      id: 'github:pr:5',
      number: 5,
      repository_id: 'github:repo:2',
      title: 'Chart the shoals',
      state: 'open',
      is_draft: 0,
      is_merged: 0,
      author_id: null,
      url: 'https://github.example/acme/harbour/pull/5',
      merge_commit_sha: null,
      created_at: '2026-10-01T08:00:00Z',
      updated_at: '2026-10-01T09:00:00Z',
      closed_at: null,
      merged_at: null,
      payload: '{}',
    },
  });

  await seedConsumerVersion({
    versionDirectory: secondDirectory,
    row: {
      id: 'github:pr:5',
      number: 5,
      repository_id: 'github:repo:2',
      title: 'Chart the shoals and reefs',
      state: 'open',
      is_draft: 0,
      is_merged: 0,
      author_id: null,
      url: 'https://github.example/acme/harbour/pull/5',
      merge_commit_sha: null,
      created_at: '2026-10-01T08:00:00Z',
      updated_at: '2026-10-01T10:00:00Z',
      closed_at: null,
      merged_at: null,
      payload: '{}',
    },
  });

  await symlink(firstDirectory, currentLink);

  await ctx.client.get_entity({ id: 'github:pr:5' });

  await unlink(currentLink);
  await symlink(secondDirectory, currentLink);

  const result = await ctx.client.get_entity({ id: 'github:pr:5' });

  expect(result.entity.title).toBe('Chart the shoals and reefs');
});

import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm, symlink, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import { githubPullRequestConsumer } from '@pepys/source-github';
import { createApp } from './create-app.ts';
import { createStoreReader } from './create-store-reader.ts';
import { createStubConsumerVersion } from './create-stub-consumer-version.ts';
import { openConsumerDatabase } from './open-consumer-database.ts';
import type { APIClient } from './types.ts';

async function setupTest() {
  const storeDirectory = await mkdtemp(join(tmpdir(), 'pepys-api-'));

  onTestFinished(() => rm(storeDirectory, { recursive: true, force: true }));

  const store = createStoreReader({ storeDirectory, openDatabase: openConsumerDatabase });

  onTestFinished(() => store.close());

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

test('it returns the entity view row and the full row of a pull request', async () => {
  const ctx = await setupTest();

  const versionDirectory = join(ctx.consumerDirectory, 'v1');

  await createStubConsumerVersion({
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
  });
});

test('it answers NOT_FOUND for an entity the consumer does not hold', async () => {
  const ctx = await setupTest();

  const versionDirectory = join(ctx.consumerDirectory, 'v1');

  await createStubConsumerVersion({
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

  await createStubConsumerVersion({
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

  await createStubConsumerVersion({
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

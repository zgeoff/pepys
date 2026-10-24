import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm, symlink, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStoreReader } from './create-store-reader.ts';
import { createStubConsumerVersion } from './create-stub-consumer-version.ts';

async function setupTest() {
  const storeDirectory = await mkdtemp(join(tmpdir(), 'pepys-reader-'));

  onTestFinished(() => rm(storeDirectory, { recursive: true, force: true }));

  const store = createStoreReader(storeDirectory);

  onTestFinished(() => store.close());

  return { store, consumerDirectory: join(storeDirectory, 'github_pull_request') };
}

test('it finishes a read that spans a swap of the current link', async () => {
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
      updated_at: '2026-10-01T09:00:00Z',
      closed_at: null,
      merged_at: null,
      payload: '{}',
    },
  });

  await symlink(firstDirectory, currentLink);

  const titles = await ctx.store.withConsumer('github_pull_request', async (transaction) => {
    const first = await transaction.selectFrom('entity').select('title').executeTakeFirstOrThrow();

    await unlink(currentLink);
    await symlink(secondDirectory, currentLink);

    // a second request sees the new target and retires the database the first still reads
    const second = await ctx.store.withConsumer('github_pull_request', (other) =>
      other.selectFrom('entity').select('title').executeTakeFirstOrThrow(),
    );

    const rest = await transaction
      .selectFrom('github_pull_request')
      .select('title')
      .executeTakeFirstOrThrow();

    return [first.title, second.title, rest.title];
  });

  expect(titles).toStrictEqual([
    'Chart the shoals',
    'Chart the shoals and reefs',
    'Chart the shoals',
  ]);
});

import { expect, mock, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm, symlink, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import invariant from 'tiny-invariant';
import { createStoreReader } from './create-store-reader.ts';
import { createStubConsumerVersion } from './create-stub-consumer-version.ts';
import { openConsumerDatabase } from './open-consumer-database.ts';

async function setupTest() {
  const storeDirectory = await mkdtemp(join(tmpdir(), 'pepys-reader-'));

  onTestFinished(() => rm(storeDirectory, { recursive: true, force: true }));

  const openDatabase = mock(openConsumerDatabase);
  const store = createStoreReader({ storeDirectory, openDatabase });

  onTestFinished(() => store.close());

  return { store, openDatabase, consumerDirectory: join(storeDirectory, 'github_pull_request') };
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

    invariant(second.ok);

    return [first.title, second.value.title, rest.title];
  });

  expect(titles).toStrictEqual({
    ok: true,
    value: ['Chart the shoals', 'Chart the shoals and reefs', 'Chart the shoals'],
  });
});

test('it reports no current version for a consumer whose current link does not exist', async () => {
  const ctx = await setupTest();

  const result = await ctx.store.withConsumer('github_pull_request', (transaction) =>
    transaction.selectFrom('entity').select('title').execute(),
  );

  expect(result).toStrictEqual({ ok: false, failure: { reason: 'no-current-version' } });
});

test('it serves concurrent reads of a new target from one database', async () => {
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

  await ctx.store.withConsumer('github_pull_request', (transaction) =>
    transaction.selectFrom('entity').select('title').execute(),
  );

  await unlink(currentLink);
  await symlink(secondDirectory, currentLink);

  const results = await Promise.all([
    ctx.store.withConsumer('github_pull_request', (transaction) =>
      transaction.selectFrom('entity').select('title').executeTakeFirstOrThrow(),
    ),
    ctx.store.withConsumer('github_pull_request', (transaction) =>
      transaction.selectFrom('entity').select('title').executeTakeFirstOrThrow(),
    ),
  ]);

  expect(ctx.openDatabase.mock.calls).toStrictEqual([
    [join(firstDirectory, 'consumer.db')],
    [join(secondDirectory, 'consumer.db')],
  ]);

  expect(results).toStrictEqual([
    { ok: true, value: { title: 'Chart the shoals and reefs' } },
    { ok: true, value: { title: 'Chart the shoals and reefs' } },
  ]);
});

test('it keeps one snapshot for a read that spans a commit to the same file', async () => {
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

  const titles = await ctx.store.withConsumer('github_pull_request', async (transaction) => {
    const first = await transaction.selectFrom('entity').select('title').executeTakeFirstOrThrow();

    // Turso shares one database per path within a process, so the writer runs in its own, as the
    // host does
    const writer = Bun.spawn(
      [
        process.execPath,
        '--eval',
        `import { connect } from '@tursodatabase/database';
         const writer = await connect(${JSON.stringify(join(versionDirectory, 'consumer.db'))}, { experimental: ['multiprocess_wal'] });
         await writer.run("update github_pull_request set title = 'Chart the reefs'");
         await writer.close();`,
      ],
      { cwd: import.meta.dir },
    );

    const writerExitCode = await writer.exited;

    const rest = await transaction
      .selectFrom('github_pull_request')
      .select('title')
      .executeTakeFirstOrThrow();

    return { writerExitCode, titles: [first.title, rest.title] };
  });

  expect(titles).toStrictEqual({
    ok: true,
    value: { writerExitCode: 0, titles: ['Chart the shoals', 'Chart the shoals'] },
  });
});

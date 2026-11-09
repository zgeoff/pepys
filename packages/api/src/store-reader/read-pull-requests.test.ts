import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedConsumerVersion } from '../test-utils/seed-consumer-version.ts';
import { createStoreReader } from './create-store-reader.ts';
import { openConsumerDatabase } from './open-consumer-database.ts';
import { readPullRequests } from './read-pull-requests.ts';

async function setupTest() {
  const stack = new AsyncDisposableStack();

  onTestFinished(() => stack.disposeAsync());

  const storeDirectory = await mkdtemp(join(tmpdir(), 'pepys-pull-requests-'));

  stack.defer(() => rm(storeDirectory, { recursive: true, force: true }));

  const store = createStoreReader({ storeDirectory, openDatabase: openConsumerDatabase });

  stack.defer(() => store.close());

  return { store, consumerDirectory: join(storeDirectory, 'github_pull_request') };
}

test('it reads each stored pull request row of the current version', async () => {
  const ctx = await setupTest();

  await seedConsumerVersion({
    versionDirectory: join(ctx.consumerDirectory, 'v1'),
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
      payload: '{"number":5}',
    },
  });

  await symlink(join(ctx.consumerDirectory, 'v1'), join(ctx.consumerDirectory, 'current'));

  const result = await readPullRequests(ctx.store);

  expect(result).toStrictEqual({
    ok: true,
    value: [
      {
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
        payload: '{"number":5}',
      },
    ],
  });
});

test('it returns no-current-version when the consumer has no current version', async () => {
  const ctx = await setupTest();
  const result = await readPullRequests(ctx.store);

  expect(result).toStrictEqual({ ok: false, failure: { reason: 'no-current-version' } });
});

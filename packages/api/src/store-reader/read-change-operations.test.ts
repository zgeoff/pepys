import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedConsumerVersion } from '../test-utils/seed-consumer-version.ts';
import { createStoreReader } from './create-store-reader.ts';
import { openConsumerDatabase } from './open-consumer-database.ts';
import { readChangeOperations } from './read-change-operations.ts';

async function setupTest() {
  const stack = new AsyncDisposableStack();

  onTestFinished(() => stack.disposeAsync());

  const storeDirectory = await mkdtemp(join(tmpdir(), 'pepys-change-log-'));

  stack.defer(() => rm(storeDirectory, { recursive: true, force: true }));

  const store = createStoreReader({ storeDirectory, openDatabase: openConsumerDatabase });

  stack.defer(() => store.close());

  return { store, consumerDirectory: join(storeDirectory, 'github_pull_request') };
}

test('it reads the key and operation of each change, batch by batch', async () => {
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
      payload: '{}',
    },
    changeLog: [
      {
        batch: 2,
        changes:
          '[{"key":"github:pr:5","headers":{"operation":"update"}},{"key":"github:pr:6","headers":{"operation":"insert"}}]',
      },
      { batch: 1, changes: '[{"key":"github:pr:5","headers":{"operation":"insert"}}]' },
    ],
  });

  await symlink(join(ctx.consumerDirectory, 'v1'), join(ctx.consumerDirectory, 'current'));

  const result = await readChangeOperations(ctx.store, 'github_pull_request');

  expect(result).toStrictEqual({
    ok: true,
    value: [
      { key: 'github:pr:5', operation: 'insert' },
      { key: 'github:pr:5', operation: 'update' },
      { key: 'github:pr:6', operation: 'insert' },
    ],
  });
});

test('it returns no-current-version for a consumer with no current version', async () => {
  const ctx = await setupTest();
  const result = await readChangeOperations(ctx.store, 'github_pull_request');

  expect(result).toStrictEqual({ ok: false, failure: { reason: 'no-current-version' } });
});

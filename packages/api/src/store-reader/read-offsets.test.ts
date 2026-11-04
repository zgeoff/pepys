import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStubConsumerVersion } from '../test-utils/create-stub-consumer-version.ts';
import { createStoreReader } from './create-store-reader.ts';
import { openConsumerDatabase } from './open-consumer-database.ts';
import { readOffsets } from './read-offsets.ts';

async function setupTest() {
  const storeDirectory = await mkdtemp(join(tmpdir(), 'pepys-offsets-'));

  onTestFinished(() => rm(storeDirectory, { recursive: true, force: true }));

  const store = createStoreReader({ storeDirectory, openDatabase: openConsumerDatabase });

  onTestFinished(() => store.close());

  return { store, consumerDirectory: join(storeDirectory, 'github_pull_request') };
}

test('it reads the last sequence number of each stream the consumer reads', async () => {
  const ctx = await setupTest();

  await createStubConsumerVersion({
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
    offsets: [{ stream: 'facts.github.pull_request', lastSeqNum: 41 }],
  });

  await symlink(join(ctx.consumerDirectory, 'v1'), join(ctx.consumerDirectory, 'current'));

  const result = await readOffsets(ctx.store, 'github_pull_request');

  expect(result).toStrictEqual({
    ok: true,
    value: [{ stream: 'facts.github.pull_request', lastSeqNum: 41 }],
  });
});

test('it returns no-current-version for a consumer with no current version', async () => {
  const ctx = await setupTest();
  const result = await readOffsets(ctx.store, 'github_pull_request');

  expect(result).toStrictEqual({ ok: false, failure: { reason: 'no-current-version' } });
});

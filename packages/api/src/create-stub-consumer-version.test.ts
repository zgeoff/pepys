import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from '@tursodatabase/database';
import { createStubConsumerVersion } from './create-stub-consumer-version.ts';

async function setupTest() {
  const directory = await mkdtemp(join(tmpdir(), 'stub-consumer-'));

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  return { directory };
}

test('it writes a consumer file holding the row and the entity view', async () => {
  const ctx = await setupTest();

  const versionDirectory = join(ctx.directory, 'v1');

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

  const database = await connect(join(versionDirectory, 'consumer.db'), { readonly: true });

  onTestFinished(() => database.close());

  const statement = await database.prepare('select id, kind, title from entity');
  const rows = await statement.all();

  expect(rows).toStrictEqual([{ id: 'github:pr:5', kind: 'pr', title: 'Chart the shoals' }]);
});

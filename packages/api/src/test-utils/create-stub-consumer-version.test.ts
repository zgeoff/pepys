import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from '@tursodatabase/database';
import { createStubConsumerVersion } from './create-stub-consumer-version.ts';

async function setupTest() {
  const stack = new AsyncDisposableStack();

  onTestFinished(() => stack.disposeAsync());

  const directory = await mkdtemp(join(tmpdir(), 'stub-consumer-'));

  stack.defer(() => rm(directory, { recursive: true, force: true }));

  return { directory, stack };
}

test('it writes a consumer file holding the row and the entity view', async () => {
  const ctx = await setupTest();

  const versionDirectory = join(ctx.directory, 'v1');

  await createStubConsumerVersion({
    versionDirectory,
    row: {
      id: 'github:pull_request:5',
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

  ctx.stack.defer(() => database.close());

  const rows: unknown = await database.all('select id, kind, title from entity');

  expect(rows).toStrictEqual([
    { id: 'github:pull_request:5', kind: 'github:pull_request', title: 'Chart the shoals' },
  ]);
});

test('it writes the offsets and change log rows it is given beside the row', async () => {
  const ctx = await setupTest();

  const versionDirectory = join(ctx.directory, 'v1');

  await createStubConsumerVersion({
    versionDirectory,
    row: {
      id: 'github:pull_request:5',
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
    offsets: [{ stream: 'facts.github.pull_request', lastSeqNum: 7 }],
    changeLog: [{ batch: 1, changes: '[]' }],
  });

  const database = await connect(join(versionDirectory, 'consumer.db'), { readonly: true });

  ctx.stack.defer(() => database.close());

  const tables: unknown = {
    offsets: await database.all('select stream, last_seq_num from offsets'),
    changeLog: await database.all('select batch, changes from change_log'),
  };

  expect(tables).toStrictEqual({
    offsets: [{ stream: 'facts.github.pull_request', last_seq_num: 7 }],
    changeLog: [{ batch: 1, changes: '[]' }],
  });
});

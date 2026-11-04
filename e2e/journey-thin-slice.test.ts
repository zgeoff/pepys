import { expect, onTestFinished, test } from 'bun:test';
import { join } from 'node:path';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { APIClient } from '@pepys/api';
import { S2 } from '@s2-dev/streamstore';
import { connect } from '@tursodatabase/database';
import { $ } from 'bun';
import invariant from 'tiny-invariant';

function setupTest() {
  const s2Endpoint = process.env['PEPYS_S2_ENDPOINT'];
  const s2AccessToken = process.env['PEPYS_S2_ACCESS_TOKEN'];
  const s2Basin = process.env['PEPYS_S2_BASIN'];
  const storeDirectory = process.env['PEPYS_STORE_DIR'];
  const modulePath = process.env['PEPYS_E2E_MODULE'];
  const apiURL = process.env['PEPYS_E2E_API_URL'];

  invariant(
    s2Endpoint !== undefined &&
      s2AccessToken !== undefined &&
      s2Basin !== undefined &&
      storeDirectory !== undefined &&
      modulePath !== undefined &&
      apiURL !== undefined,
    'run the e2e lane with bun run test:e2e, which preloads e2e/start-thin-slice.ts',
  );

  const host = join(import.meta.dir, '../target/debug/pepys');
  const databasePath = join(storeDirectory, 'github_pull_request', 'current', 'consumer.db');

  const s2 = new S2({
    accessToken: s2AccessToken,
    endpoints: { account: s2Endpoint, basin: s2Endpoint },
  });

  const api: APIClient = createORPCClient(new RPCLink({ url: apiURL }));

  return {
    modulePath,
    api,
    runHost: (args: readonly string[]) => $`${host} ${args}`.nothrow().quiet(),
    readTail: () => s2.basin(s2Basin).stream('facts.github.pull_request').checkTail(),
    readConsumerTable: async (sql: string): Promise<unknown[]> => {
      const database = await connect(databasePath, {
        readonly: true,
        experimental: ['multiprocess_wal'],
      });

      onTestFinished(() => database.close());

      return database.all(sql);
    },
  };
}

test("it keeps one copy of each delivery's fact and four records in the stream after four deliveries, one of them a repeat", async () => {
  const ctx = setupTest();

  const response = await ctx.readTail();

  expect(response.tail.seqNum).toBe(4);
});

test('it stores the row of the newest pull request update, not the older one that arrived out of order', async () => {
  const ctx = setupTest();

  const rows = await ctx.readConsumerTable(
    `select id, number, repository_id, title, state, is_draft, is_merged, author_id, url,
      merge_commit_sha, created_at, updated_at, closed_at, merged_at
    from github_pull_request`,
  );

  expect(rows).toStrictEqual([
    {
      id: 'github:pr:1874433021',
      number: 12,
      repository_id: 'github:repo:902',
      title: 'Add the harbour map and tides',
      state: 'open',
      is_draft: 0,
      is_merged: 0,
      author_id: 'github:user:4401',
      url: 'https://github.example/acme/harbour/pull/12',
      merge_commit_sha: null,
      created_at: '2026-10-01T08:00:00Z',
      updated_at: '2026-10-01T10:00:00Z',
      closed_at: null,
      merged_at: null,
    },
  ]);
});

test("it records the stream's last sequence number as the consumer's offset", async () => {
  const ctx = setupTest();

  const offsets = await ctx.readConsumerTable('select stream, last_seq_num from offsets');

  expect(offsets).toStrictEqual([{ stream: 'facts.github.pull_request', last_seq_num: 3 }]);
});

test('it writes an insert, then an update, to the change log', async () => {
  const ctx = setupTest();

  const operations = await ctx.readConsumerTable(
    `select change.value ->> '$.key' as key, change.value ->> '$.headers.operation' as operation
    from change_log, json_each(change_log.changes) as change
    order by change_log.batch`,
  );

  expect(operations).toStrictEqual([
    { key: 'github:pr:1874433021', operation: 'insert' },
    { key: 'github:pr:1874433021', operation: 'update' },
  ]);
});

test('it shows an empty preview diff for the module that is already current', async () => {
  const ctx = setupTest();

  const output = await ctx.runHost(['preview', 'github_pull_request', '--module', ctx.modulePath]);

  const diff: unknown = output.json();

  expect({ exitCode: output.exitCode, diff }).toStrictEqual({
    exitCode: 0,
    diff: {},
  });
});

test('it swaps nothing when up runs again with the same module', async () => {
  const ctx = setupTest();

  const output = await ctx.runHost(['up', 'github_pull_request', '--module', ctx.modulePath]);

  expect({ exitCode: output.exitCode, stdout: output.text() }).toStrictEqual({
    exitCode: 0,
    stdout: expect.stringContaining('no swap'),
  });
});

test("it serves the stored row through the API's get_entity", async () => {
  const ctx = setupTest();

  const result = await ctx.api.get_entity({ id: 'github:pr:1874433021' });

  expect(result).toStrictEqual({
    entity: {
      id: 'github:pr:1874433021',
      kind: 'pr',
      title: 'Add the harbour map and tides',
      url: 'https://github.example/acme/harbour/pull/12',
      actor: 'github:user:4401',
      updated_at: '2026-10-01T10:00:00Z',
    },
    row: {
      id: 'github:pr:1874433021',
      number: 12,
      repository_id: 'github:repo:902',
      title: 'Add the harbour map and tides',
      state: 'open',
      is_draft: false,
      is_merged: false,
      author_id: 'github:user:4401',
      url: 'https://github.example/acme/harbour/pull/12',
      merge_commit_sha: null,
      created_at: '2026-10-01T08:00:00Z',
      updated_at: '2026-10-01T10:00:00Z',
      closed_at: null,
      merged_at: null,
      payload: {
        id: 1_874_433_021,
        number: 12,
        title: 'Add the harbour map and tides',
        state: 'open',
        draft: false,
        merged: false,
        merge_commit_sha: null,
        html_url: 'https://github.example/acme/harbour/pull/12',
        user: { id: 4401 },
        base: { repo: { id: 902 } },
        created_at: '2026-10-01T08:00:00Z',
        updated_at: '2026-10-01T10:00:00Z',
        closed_at: null,
        merged_at: null,
      },
    },
  });
});

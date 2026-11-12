import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from '@tursodatabase/database';
import { startLiveWriter } from './start-live-writer.ts';

async function setupTest() {
  const stack = new AsyncDisposableStack();

  onTestFinished(() => stack.disposeAsync());

  const directory = await mkdtemp(join(tmpdir(), 'live-writer-'));

  stack.defer(() => rm(directory, { recursive: true, force: true }));

  return { stack, path: join(directory, 'consumer.db') };
}

test('it commits each statement while it holds the file open', async () => {
  const ctx = await setupTest();
  const writer = await startLiveWriter(ctx.path);

  ctx.stack.defer(() => writer.stop());

  await writer.run(
    "create table harbour_berth (id text); insert into harbour_berth values ('north')",
  );

  const reader = await connect(ctx.path, { readonly: true, experimental: ['multiprocess_wal'] });

  ctx.stack.defer(() => reader.close());

  const rows: unknown = await reader.all('select id from harbour_berth');

  expect(rows).toStrictEqual([{ id: 'north' }]);
});

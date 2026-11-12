import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createConsumerVersion,
  writeCurrentVersion,
} from '../test-utils/create-consumer-version.ts';
import { harbourVesselConsumer } from '../test-utils/harbour/harbour-plugin.ts';
import { createStoreReader } from './create-store-reader.ts';
import { readOffsets } from './read-offsets.ts';

async function setupTest() {
  const stack = new AsyncDisposableStack();

  onTestFinished(() => stack.disposeAsync());

  const storeDirectory = await mkdtemp(join(tmpdir(), 'pepys-offsets-'));

  stack.defer(() => rm(storeDirectory, { recursive: true, force: true }));

  const store = createStoreReader({ storeDirectory });

  stack.defer(() => store.close());

  return { store, storeDirectory };
}

test('it reads the last sequence number of each stream the consumer reads', async () => {
  const ctx = await setupTest();

  await createConsumerVersion({
    storeDirectory: ctx.storeDirectory,
    consumer: harbourVesselConsumer,
    version: 'v1',
    offsets: [{ stream: 'facts.harbour.vessel', lastSeqNum: 41 }],
  });

  await writeCurrentVersion(ctx.storeDirectory, harbourVesselConsumer, 'v1');

  const result = await readOffsets(ctx.store, harbourVesselConsumer);

  expect(result).toStrictEqual({
    ok: true,
    value: [{ stream: 'facts.harbour.vessel', lastSeqNum: 41 }],
  });
});

test('it returns no-current-version for a consumer with no current version', async () => {
  const ctx = await setupTest();
  const result = await readOffsets(ctx.store, harbourVesselConsumer);

  expect(result).toStrictEqual({
    ok: false,
    failure: { reason: 'no-current-version', consumers: ['harbour_vessel'] },
  });
});

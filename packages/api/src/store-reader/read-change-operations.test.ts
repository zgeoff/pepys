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
import { readChangeOperations } from './read-change-operations.ts';

async function setupTest() {
  const storeDirectory = await mkdtemp(join(tmpdir(), 'pepys-change-log-'));

  onTestFinished(() => rm(storeDirectory, { recursive: true, force: true }));

  const store = createStoreReader({ storeDirectory });

  onTestFinished(() => store.close());

  return { store, storeDirectory };
}

test('it reads the key and operation of each change, batch by batch', async () => {
  const ctx = await setupTest();

  await createConsumerVersion({
    storeDirectory: ctx.storeDirectory,
    consumer: harbourVesselConsumer,
    version: 'v1',
    changeLog: [
      {
        batch: 2,
        changes:
          '[{"key":"harbour:vessel:7","headers":{"operation":"update"}},{"key":"harbour:vessel:8","headers":{"operation":"insert"}}]',
      },
      { batch: 1, changes: '[{"key":"harbour:vessel:7","headers":{"operation":"insert"}}]' },
    ],
  });

  await writeCurrentVersion(ctx.storeDirectory, harbourVesselConsumer, 'v1');

  const result = await readChangeOperations(ctx.store, harbourVesselConsumer);

  expect(result).toStrictEqual({
    ok: true,
    value: [
      { key: 'harbour:vessel:7', operation: 'insert' },
      { key: 'harbour:vessel:7', operation: 'update' },
      { key: 'harbour:vessel:8', operation: 'insert' },
    ],
  });
});

test('it returns no-current-version for a consumer with no current version', async () => {
  const ctx = await setupTest();
  const result = await readChangeOperations(ctx.store, harbourVesselConsumer);

  expect(result).toStrictEqual({
    ok: false,
    failure: { reason: 'no-current-version', consumers: ['harbour_vessel'] },
  });
});

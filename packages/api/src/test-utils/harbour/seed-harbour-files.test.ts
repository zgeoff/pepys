import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStoreReader } from '../../store-reader/create-store-reader.ts';
import { harbourVesselConsumer, harbourVoyageConsumer } from './harbour-plugin.ts';
import { seedHarbourFiles } from './seed-harbour-files.ts';

async function setupTest() {
  const stack = new AsyncDisposableStack();

  onTestFinished(() => stack.disposeAsync());

  const storeDirectory = await mkdtemp(join(tmpdir(), 'pepys-harbour-files-'));

  stack.defer(() => rm(storeDirectory, { recursive: true, force: true }));

  const store = createStoreReader({ storeDirectory });

  stack.defer(() => store.close());

  return { storeDirectory, store };
}

test('it leaves a current vessel file and a current voyage file with its links', async () => {
  const ctx = await setupTest();

  await seedHarbourFiles(ctx.storeDirectory);

  const read = await ctx.store.withConsumers(
    [harbourVesselConsumer, harbourVoyageConsumer],
    async (db) => {
      const entities = await db.selectFrom('entity').select('id').orderBy('id').execute();
      const links = await db.selectFrom('link_effective').select('type').orderBy('type').execute();

      return { entities, links };
    },
  );

  expect(read).toStrictEqual({
    ok: true,
    value: {
      entities: [{ id: 'harbour:vessel:7' }, { id: 'harbour:voyage:12' }],
      links: [{ type: 'called_at' }, { type: 'voyage_of' }],
    },
  });
});

import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, readlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from '@tursodatabase/database';
import { createConsumerVersion, writeCurrentVersion } from './create-consumer-version.ts';
import { harbourVesselConsumer, harbourVoyageConsumer } from './harbour/harbour-plugin.ts';

async function setupTest() {
  const storeDirectory = await mkdtemp(join(tmpdir(), 'pepys-version-'));

  onTestFinished(() => rm(storeDirectory, { recursive: true, force: true }));

  return {
    storeDirectory,
    readFile: async (directory: string, statement: string): Promise<unknown> => {
      const database = await connect(join(directory, 'consumer.db'), { readonly: true });

      onTestFinished(() => database.close());

      const rows: unknown = await database.all(statement);

      return rows;
    },
  };
}

test('it writes the rows, links, offsets and change log of a version in the host file layout', async () => {
  const ctx = await setupTest();

  const directory = await createConsumerVersion({
    storeDirectory: ctx.storeDirectory,
    consumer: harbourVoyageConsumer,
    version: 'v2',
    rows: {
      harbour_voyage: [
        {
          id: 'harbour:voyage:12',
          vessel_id: 'harbour:vessel:7',
          port_id: 'harbour:port:north',
          is_hailed: true,
          departed_at: '2026-11-02T06:00:00.000Z',
        },
      ],
    },
    links: [
      {
        type: 'voyage_of',
        from_id: 'harbour:voyage:12',
        to_id: 'harbour:vessel:7',
        scope: null,
        origin: 'harbour_voyage',
        confidence: 1,
        evidence: 'the manifest',
      },
    ],
    offsets: [{ stream: 'facts.harbour.voyage', lastSeqNum: 4 }],
    changeLog: [{ batch: 1, changes: '[]' }],
  });

  const stored = await ctx.readFile(
    directory,
    `select
       (select json_group_array(json_array(id, is_hailed)) from harbour_voyage) as voyages,
       (select json_group_array(type) from link) as links,
       (select json_group_array(last_seq_num) from offsets) as offsets,
       (select json_group_array(batch) from change_log) as batches`,
  );

  expect({ directory, stored }).toStrictEqual({
    directory: join(ctx.storeDirectory, 'harbour_voyage', 'v2'),
    stored: [
      {
        voyages: '[["harbour:voyage:12",1]]',
        links: '["voyage_of"]',
        offsets: '[4]',
        batches: '[1]',
      },
    ],
  });
});

test('it makes no link table for a consumer without link types', async () => {
  const ctx = await setupTest();

  const directory = await createConsumerVersion({
    storeDirectory: ctx.storeDirectory,
    consumer: harbourVesselConsumer,
    version: 'v1',
  });

  const tables = await ctx.readFile(
    directory,
    "select name from sqlite_schema where name = 'link'",
  );

  expect(tables).toStrictEqual([]);
});

test('#writeCurrentVersion points the current link at the version, and again at a newer one', async () => {
  const ctx = await setupTest();

  for (const version of ['v1', 'v2']) {
    await createConsumerVersion({
      storeDirectory: ctx.storeDirectory,
      consumer: harbourVesselConsumer,
      version,
    });
  }

  await writeCurrentVersion(ctx.storeDirectory, harbourVesselConsumer, 'v1');
  await writeCurrentVersion(ctx.storeDirectory, harbourVesselConsumer, 'v2');

  const target = await readlink(join(ctx.storeDirectory, 'harbour_vessel', 'current'));

  expect(target).toBe(join(ctx.storeDirectory, 'harbour_vessel', 'v2'));
});

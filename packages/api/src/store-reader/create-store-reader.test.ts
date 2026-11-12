import { expect, onTestFinished, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, readlink, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import {
  createConsumerVersion,
  writeCurrentVersion,
} from '../test-utils/create-consumer-version.ts';
import {
  harbourVesselConsumer,
  harbourVoyageConsumer,
} from '../test-utils/harbour/harbour-plugin.ts';
import { startLiveWriter } from '../test-utils/start-live-writer.ts';
import { createStoreReader } from './create-store-reader.ts';

async function setupTest() {
  const stack = new AsyncDisposableStack();

  onTestFinished(() => stack.disposeAsync());

  const storeDirectory = await mkdtemp(join(tmpdir(), 'pepys-reader-'));

  stack.defer(() => rm(storeDirectory, { recursive: true, force: true }));

  const store = createStoreReader({ storeDirectory });

  stack.defer(() => store.close());

  return { stack, store, storeDirectory };
}

test('it joins the tables of two attached files and shows the entities and links of both', async () => {
  const ctx = await setupTest();

  await createConsumerVersion({
    storeDirectory: ctx.storeDirectory,
    consumer: harbourVesselConsumer,
    version: 'v1',
    rows: {
      harbour_vessel: [
        { id: 'harbour:vessel:7', name: 'Tern', updated_at: '2026-11-01T08:00:00.000Z' },
      ],
    },
  });

  await createConsumerVersion({
    storeDirectory: ctx.storeDirectory,
    consumer: harbourVoyageConsumer,
    version: 'v3',
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
  });

  await writeCurrentVersion(ctx.storeDirectory, harbourVesselConsumer, 'v1');
  await writeCurrentVersion(ctx.storeDirectory, harbourVoyageConsumer, 'v3');

  const result: unknown = await ctx.store.withConsumers(
    [harbourVesselConsumer, harbourVoyageConsumer],
    async (db, call) => ({
      call,
      joined: await db
        .selectFrom('harbour_voyage')
        .innerJoin('harbour_vessel', 'harbour_vessel.id', 'harbour_voyage.vessel_id')
        .select(['harbour_voyage.id', 'harbour_vessel.name'])
        .execute(),
      entities: await db.selectFrom('entity').select(['id', 'kind']).orderBy('id').execute(),
      links: await db.selectFrom('link_effective').select(['type', 'from_id', 'to_id']).execute(),
    }),
  );

  expect(result).toStrictEqual({
    ok: true,
    value: {
      call: {
        attached: { harbour_vessel: { version: 'v1' }, harbour_voyage: { version: 'v3' } },
        skipped: [],
      },
      joined: [{ id: 'harbour:voyage:12', name: 'Tern' }],
      entities: [
        { id: 'harbour:vessel:7', kind: 'harbour:vessel' },
        { id: 'harbour:voyage:12', kind: 'harbour:voyage' },
      ],
      links: [{ type: 'voyage_of', from_id: 'harbour:voyage:12', to_id: 'harbour:vessel:7' }],
    },
  });
});

test('it names every required consumer with no current version and runs no work', async () => {
  const ctx = await setupTest();

  let isRun = false;

  const result = await ctx.store.withConsumers(
    [harbourVesselConsumer, harbourVoyageConsumer],
    () => {
      isRun = true;

      return Promise.resolve(null);
    },
  );

  expect({ result, isRun }).toStrictEqual({
    result: {
      ok: false,
      failure: { reason: 'no-current-version', consumers: ['harbour_vessel', 'harbour_voyage'] },
    },
    isRun: false,
  });
});

test('it attaches each optional consumer with a current version and names the rest as skipped', async () => {
  const ctx = await setupTest();

  await createConsumerVersion({
    storeDirectory: ctx.storeDirectory,
    consumer: harbourVesselConsumer,
    version: 'v1',
    rows: {
      harbour_vessel: [
        { id: 'harbour:vessel:7', name: 'Tern', updated_at: '2026-11-01T08:00:00.000Z' },
      ],
    },
  });

  await writeCurrentVersion(ctx.storeDirectory, harbourVesselConsumer, 'v1');

  const result = await ctx.store.withConsumers(
    [],
    async (db, call) => ({
      call,
      entities: await db.selectFrom('entity').select('id').execute(),
      links: await db.selectFrom('link_effective').select('type').execute(),
    }),
    { whenCurrent: [harbourVesselConsumer, harbourVoyageConsumer] },
  );

  expect(result).toStrictEqual({
    ok: true,
    value: {
      call: { attached: { harbour_vessel: { version: 'v1' } }, skipped: ['harbour_voyage'] },
      entities: [{ id: 'harbour:vessel:7' }],
      links: [],
    },
  });
});

test('it finishes a call on the version it resolved when the current link swings during it', async () => {
  const ctx = await setupTest();

  for (const [version, name] of [
    ['v1', 'Tern'],
    ['v2', 'Tern of the North'],
  ] as const) {
    await createConsumerVersion({
      storeDirectory: ctx.storeDirectory,
      consumer: harbourVesselConsumer,
      version,
      rows: {
        harbour_vessel: [{ id: 'harbour:vessel:7', name, updated_at: '2026-11-01T08:00:00.000Z' }],
      },
    });
  }

  await writeCurrentVersion(ctx.storeDirectory, harbourVesselConsumer, 'v1');

  const result = await ctx.store.withConsumers([harbourVesselConsumer], async (db) => {
    const first = await db.selectFrom('harbour_vessel').select('name').executeTakeFirstOrThrow();

    await writeCurrentVersion(ctx.storeDirectory, harbourVesselConsumer, 'v2');

    const second = await ctx.store.withConsumers([harbourVesselConsumer], (other) =>
      other.selectFrom('harbour_vessel').select('name').executeTakeFirstOrThrow(),
    );

    const rest = await db.selectFrom('entity').select('title').executeTakeFirstOrThrow();

    return { first: first.name, second, rest: rest.title };
  });

  expect(result).toStrictEqual({
    ok: true,
    value: {
      first: 'Tern',
      second: { ok: true, value: { name: 'Tern of the North' } },
      rest: 'Tern',
    },
  });
});

test('it closes the file of a version the host swapped away from between calls', async () => {
  const ctx = await setupTest();

  const directory = await createConsumerVersion({
    storeDirectory: ctx.storeDirectory,
    consumer: harbourVesselConsumer,
    version: 'v1',
  });

  await createConsumerVersion({
    storeDirectory: ctx.storeDirectory,
    consumer: harbourVesselConsumer,
    version: 'v2',
  });

  await writeCurrentVersion(ctx.storeDirectory, harbourVesselConsumer, 'v1');

  await ctx.store.withConsumers([harbourVesselConsumer], (db) =>
    db.selectFrom('harbour_vessel').select('id').execute(),
  );

  await writeCurrentVersion(ctx.storeDirectory, harbourVesselConsumer, 'v2');

  await ctx.store.withConsumers([harbourVesselConsumer], (db) =>
    db.selectFrom('harbour_vessel').select('id').execute(),
  );

  const retiredDirectory = await realpath(directory);
  const descriptors = await readdir('/proc/self/fd');

  const targets = await Promise.all(
    descriptors.map((descriptor) => readlink(join('/proc/self/fd', descriptor)).catch(() => null)),
  );

  expect(targets.filter((target) => target?.startsWith(retiredDirectory) === true)).toStrictEqual(
    [],
  );
});

test('it opens a file again once the host replaces a file it failed to open', async () => {
  const ctx = await setupTest();

  const directory = join(ctx.storeDirectory, harbourVesselConsumer.name, 'v1');

  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'consumer.db'), 'a page torn in half');
  await writeCurrentVersion(ctx.storeDirectory, harbourVesselConsumer, 'v1');

  await ctx.store
    .withConsumers([harbourVesselConsumer], (db) =>
      db.selectFrom('harbour_vessel').select('name').execute(),
    )
    .catch(() => null);

  await rm(join(directory, 'consumer.db'));

  await createConsumerVersion({
    storeDirectory: ctx.storeDirectory,
    consumer: harbourVesselConsumer,
    version: 'v1',
    rows: {
      harbour_vessel: [
        { id: 'harbour:vessel:7', name: 'Tern', updated_at: '2026-11-01T08:00:00.000Z' },
      ],
    },
  });

  const result = await ctx.store.withConsumers([harbourVesselConsumer], (db) =>
    db.selectFrom('harbour_vessel').select('name').execute(),
  );

  expect(result).toStrictEqual({ ok: true, value: [{ name: 'Tern' }] });
});

test('it closes after a call that failed to open a file', async () => {
  const ctx = await setupTest();

  const directory = join(ctx.storeDirectory, harbourVesselConsumer.name, 'v1');

  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'consumer.db'), 'a page torn in half');
  await writeCurrentVersion(ctx.storeDirectory, harbourVesselConsumer, 'v1');

  await ctx.store
    .withConsumers([harbourVesselConsumer], (db) =>
      db.selectFrom('harbour_vessel').select('name').execute(),
    )
    .catch(() => null);

  await expect(ctx.store.close()).toResolve();
});

test('it keeps one snapshot of a file that the host holds open and commits to during the call', async () => {
  const ctx = await setupTest();

  const directory = await createConsumerVersion({
    storeDirectory: ctx.storeDirectory,
    consumer: harbourVesselConsumer,
    version: 'v1',
    rows: {
      harbour_vessel: [
        { id: 'harbour:vessel:7', name: 'Tern', updated_at: '2026-11-01T08:00:00.000Z' },
      ],
    },
  });

  await writeCurrentVersion(ctx.storeDirectory, harbourVesselConsumer, 'v1');

  const writer = await startLiveWriter(join(directory, 'consumer.db'));

  ctx.stack.defer(() => writer.stop());

  // oxlint-disable-next-line zgeoff/seed-only -- the host's own write, which the reader must see
  await writer.run("update harbour_vessel set name = 'Tern II'");

  const during = await ctx.store.withConsumers([harbourVesselConsumer], async (db) => {
    const first = await db.selectFrom('harbour_vessel').select('name').executeTakeFirstOrThrow();

    // oxlint-disable-next-line zgeoff/seed-only -- the host's write during the call
    await writer.run("update harbour_vessel set name = 'Tern III'");

    const rest = await db.selectFrom('entity').select('title').executeTakeFirstOrThrow();

    return [first.name, rest.title];
  });

  const after = await ctx.store.withConsumers([harbourVesselConsumer], (db) =>
    db.selectFrom('harbour_vessel').select('name').executeTakeFirstOrThrow(),
  );

  expect({ during, after }).toStrictEqual({
    during: { ok: true, value: ['Tern II', 'Tern II'] },
    after: { ok: true, value: { name: 'Tern III' } },
  });
});

test('it refuses a write to an attached file', async () => {
  const ctx = await setupTest();

  await createConsumerVersion({
    storeDirectory: ctx.storeDirectory,
    consumer: harbourVesselConsumer,
    version: 'v1',
  });

  await writeCurrentVersion(ctx.storeDirectory, harbourVesselConsumer, 'v1');

  expect(
    ctx.store.withConsumers([harbourVesselConsumer], (db) =>
      // oxlint-disable-next-line zgeoff/seed-only -- the write the reader must refuse
      db.deleteFrom('harbour_vessel').execute(),
    ),
  ).rejects.toThrow(/readonly/u);
});

test('it attaches a file whose folder name holds a space, a percent sign, a hash and a quote', async () => {
  const ctx = await setupTest();

  const storeDirectory = join(ctx.storeDirectory, "dock 7%20#north's");

  await mkdir(storeDirectory);

  await createConsumerVersion({
    storeDirectory,
    consumer: harbourVesselConsumer,
    version: 'v1',
    rows: {
      harbour_vessel: [
        { id: 'harbour:vessel:7', name: 'Tern', updated_at: '2026-11-01T08:00:00.000Z' },
      ],
    },
  });

  await writeCurrentVersion(storeDirectory, harbourVesselConsumer, 'v1');

  const store = createStoreReader({ storeDirectory });

  ctx.stack.defer(() => store.close());

  const result = await store.withConsumers([harbourVesselConsumer], (db) =>
    sql`select name from harbour_vessel`.execute(db),
  );

  expect(result).toStrictEqual({ ok: true, value: { rows: [{ name: 'Tern' }] } });
});

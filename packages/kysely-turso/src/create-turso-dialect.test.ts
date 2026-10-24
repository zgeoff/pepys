import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from '@tursodatabase/database';
import { Kysely } from 'kysely';
import { createTursoDialect } from './create-turso-dialect.ts';

interface Schema {
  item: { id: number; kind: string; number: number };
}

async function setupTest() {
  const directory = await mkdtemp(join(tmpdir(), 'kysely-turso-'));

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  const path = join(directory, 'items.db');

  const setup = await connect(path);

  await setup.exec(
    'create table item (id integer primary key, kind text not null, number integer not null)',
  );

  await setup.close();

  return { path };
}

test('it selects rows through a read-only connection', async () => {
  const ctx = await setupTest();

  const writer = new Kysely<Schema>({
    dialect: createTursoDialect({ database: () => connect(ctx.path) }),
  });

  await writer
    .insertInto('item')
    .values([
      { id: 1, kind: 'pr', number: 7 },
      { id: 2, kind: 'issue', number: 9 },
    ])
    .execute();

  await writer.destroy();

  const reader = new Kysely<Schema>({
    dialect: createTursoDialect({ database: () => connect(ctx.path, { readonly: true }) }),
  });

  onTestFinished(() => reader.destroy());

  const rows = await reader.selectFrom('item').selectAll().orderBy('id').execute();

  expect(rows).toStrictEqual([
    { id: 1, kind: 'pr', number: 7 },
    { id: 2, kind: 'issue', number: 9 },
  ]);
});

test('it binds the parameters of a where clause in order', async () => {
  const ctx = await setupTest();

  const db = new Kysely<Schema>({
    dialect: createTursoDialect({ database: () => connect(ctx.path) }),
  });

  onTestFinished(() => db.destroy());

  await db
    .insertInto('item')
    .values([
      { id: 1, kind: 'pr', number: 3 },
      { id: 2, kind: 'pr', number: 8 },
      { id: 3, kind: 'issue', number: 8 },
    ])
    .execute();

  const rows = await db
    .selectFrom('item')
    .select('id')
    .where('kind', '=', 'pr')
    .where('number', '>', 5)
    .execute();

  expect(rows).toStrictEqual([{ id: 2 }]);
});

test('it reports the insert ID and the affected row count of a write', async () => {
  const ctx = await setupTest();

  const db = new Kysely<Schema>({
    dialect: createTursoDialect({ database: () => connect(ctx.path) }),
  });

  onTestFinished(() => db.destroy());

  const result = await db
    .insertInto('item')
    .values({ id: 4, kind: 'pr', number: 1 })
    .executeTakeFirstOrThrow();

  expect(result.insertId).toBe(4n);
  expect(result.numInsertedOrUpdatedRows).toBe(1n);
});

test('it refuses a write on a read-only connection', async () => {
  const ctx = await setupTest();

  const reader = new Kysely<Schema>({
    dialect: createTursoDialect({ database: () => connect(ctx.path, { readonly: true }) }),
  });

  onTestFinished(() => reader.destroy());

  expect(
    reader.insertInto('item').values({ id: 1, kind: 'pr', number: 1 }).execute(),
  ).rejects.toThrow();
});

test('it commits the writes of a finished transaction', async () => {
  const ctx = await setupTest();

  const db = new Kysely<Schema>({
    dialect: createTursoDialect({ database: () => connect(ctx.path) }),
  });

  onTestFinished(() => db.destroy());

  await db.transaction().execute(async (transaction) => {
    await transaction.insertInto('item').values({ id: 1, kind: 'pr', number: 1 }).execute();
  });

  const rows = await db.selectFrom('item').select('id').execute();

  expect(rows).toStrictEqual([{ id: 1 }]);
});

test('it rolls back the writes of a failed transaction', async () => {
  const ctx = await setupTest();

  const db = new Kysely<Schema>({
    dialect: createTursoDialect({ database: () => connect(ctx.path) }),
  });

  onTestFinished(() => db.destroy());

  const failure = await db
    .transaction()
    .execute(async (transaction) => {
      await transaction.insertInto('item').values({ id: 1, kind: 'pr', number: 1 }).execute();

      throw new Error('abandon the transaction');
    })
    .then(
      () => null,
      (error: unknown) => error,
    );

  const rows = await db.selectFrom('item').select('id').execute();

  expect(failure).toStrictEqual(new Error('abandon the transaction'));
  expect(rows).toStrictEqual([]);
});

test('it lets a running transaction finish when the database is destroyed', async () => {
  const ctx = await setupTest();

  const db = new Kysely<Schema>({
    dialect: createTursoDialect({ database: () => connect(ctx.path) }),
  });

  const destroyed = Promise.withResolvers<void>();

  const rows = await db.transaction().execute(async (transaction) => {
    await transaction.selectFrom('item').select('id').execute();

    void db.destroy().then(destroyed.resolve);

    return transaction.selectFrom('item').select('id').execute();
  });

  await destroyed.promise;

  expect(rows).toStrictEqual([]);
});

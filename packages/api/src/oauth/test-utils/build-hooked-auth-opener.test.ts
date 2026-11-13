import { expect, onTestFinished, test } from 'bun:test';
import { join } from 'node:path';
import { Kysely, sql } from 'kysely';
import { buildHookedAuthOpener } from './build-hooked-auth-opener.ts';
import { openTestAuthDatabase } from './open-test-auth-database.ts';
import { setupTempDir } from './setup-temp-dir.ts';

function setupTest() {
  const temporaryDirectory = setupTempDir('pepys-hooked-auth-db-');
  const opener = buildHookedAuthOpener(openTestAuthDatabase);
  const path = join(temporaryDirectory.path, 'mcp-auth.db');
  const database = opener.openDatabase(path);

  const db = new Kysely({ dialect: database.dialect });

  const otherDatabase = openTestAuthDatabase(path);

  const other = new Kysely({ dialect: otherDatabase.dialect });

  onTestFinished(async () => {
    await db.destroy();
    await other.destroy();

    database.close();
    otherDatabase.close();
  });

  return { opener, db, other };
}

test('it runs the armed callback once, before the first matching query', async () => {
  const ctx = setupTest();

  await sql`create table note (id text)`.execute(ctx.db);

  ctx.opener.armBeforeQuery(/^insert into "note"/u, async () => {
    await sql`insert into note (id) values ('from-the-other-connection')`.execute(ctx.other);
  });

  await sql`select 1`.execute(ctx.db);
  await sql`insert into "note" (id) values ('n1')`.execute(ctx.db);
  await sql`insert into "note" (id) values ('n2')`.execute(ctx.db);

  const rows = await sql`select id from note order by rowid`.execute(ctx.other);

  expect(rows.rows).toStrictEqual([
    { id: 'from-the-other-connection' },
    { id: 'n1' },
    { id: 'n2' },
  ]);
});

test('it runs a query of the same database while the armed work waits on it', async () => {
  const ctx = setupTest();

  await sql`create table note (id text)`.execute(ctx.db);

  ctx.opener.armBeforeQuery(/^insert into "note"/u, async () => {
    await sql`insert into note (id) values ('while-the-first-waits')`.execute(ctx.db);
  });

  await sql`insert into "note" (id) values ('first')`.execute(ctx.db);

  const rows = await sql`select id from note order by rowid`.execute(ctx.db);

  expect(rows.rows).toStrictEqual([{ id: 'while-the-first-waits' }, { id: 'first' }]);
});

test('it keeps a transaction on one connection while another query waits for it', async () => {
  const ctx = setupTest();

  await sql`create table note (id text)`.execute(ctx.db);

  const committed = ctx.db.transaction().execute(async (trx) => {
    await sql`insert into note (id) values ('in-the-transaction')`.execute(trx);
    await sql`insert into note (id) values ('still-in-it')`.execute(trx);
  });

  const outside = sql`insert into note (id) values ('outside')`.execute(ctx.db);

  await Promise.all([committed, outside]);

  const rows = await sql`select id from note order by rowid`.execute(ctx.db);

  expect(rows.rows).toStrictEqual([
    { id: 'in-the-transaction' },
    { id: 'still-in-it' },
    { id: 'outside' },
  ]);
});

test('it sends every query on unchanged when nothing is armed', async () => {
  const ctx = setupTest();

  await sql`create table note (id text)`.execute(ctx.db);
  await sql`insert into note (id) values ('n1')`.execute(ctx.db);

  const rows = await sql`select id from note`.execute(ctx.db);

  expect(rows.rows).toStrictEqual([{ id: 'n1' }]);
});

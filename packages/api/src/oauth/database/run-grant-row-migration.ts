import type { Database } from 'bun:sqlite';
import type { GrantID, OAuthClientID } from '@zgeoff/mcp-auth';
import { toTagged } from '@zgeoff/std';
import { z } from 'zod';
import { GRANT_SCOPES } from '../constants.ts';
import { buildTableSQL } from './build-table-sql.ts';
import type { TableColumn, TableForeignKey } from './build-table-sql.ts';
import { collectGrantRows } from './collect-grant-rows.ts';
import type { GrantRow, StoredToken } from './collect-grant-rows.ts';

// The tables whose rows end with their grant: each references the grant's
// user row with on delete cascade once the migration rebuilds it.
const CASCADING_TABLES = ['oauthAccessToken', 'oauthRefreshToken', 'session'] as const;

// The columns the auth core adds to better-auth's user table.
const GRANT_COLUMNS: readonly TableColumn[] = [
  { name: 'clientId', type: 'text', notnull: 1, dflt_value: null, pk: 0, isUnique: false },
  { name: 'scopes', type: 'text', notnull: 0, dflt_value: null, pk: 0, isUnique: false },
  { name: 'approvedBy', type: 'text', notnull: 1, dflt_value: null, pk: 0, isUnique: false },
  { name: 'limits', type: 'text', notnull: 0, dflt_value: null, pk: 0, isUnique: false },
  { name: 'lastUsedAt', type: 'date', notnull: 0, dflt_value: null, pk: 0, isUnique: false },
];

const ClientRowSchema = z.object({ clientId: z.string(), name: z.string().nullable() });

// Gives each live grant, which was the authorization code ID its tokens carry,
// a user row of its own in place of the one owner row. The caller runs it in a
// transaction with foreign keys off.
export function runGrantRowMigration(sqlite: Database, now: number): void {
  const userColumns = readTableColumns(sqlite, 'user');

  // A new file has no user table until the core opens it, and a file the core
  // opened already holds grant rows.
  if (userColumns.length === 0 || userColumns.some((column) => column.name === 'clientId')) {
    return;
  }

  const at = new Date(now).toISOString();

  const rows = collectGrantRows({
    tokens: readStoredTokens(sqlite, at),
    revoked: readRevokedGrants(sqlite),
    clientNames: new Map(
      sqlite
        .query('select clientId, name from oauthClient')
        .all()
        .map((row) => ClientRowSchema.parse(row))
        .map((row) => [toTagged<OAuthClientID>(row.clientId), row.name]),
    ),
    lastUsedAt: readGrantUses(sqlite),
    scopes: GRANT_SCOPES,
    at,
  });

  const grantIDs = JSON.stringify(rows.map((row) => row.id));

  sqlite.run('drop trigger if exists "pepys_refuse_revoked_oauthAccessToken"');
  sqlite.run('drop trigger if exists "pepys_refuse_revoked_oauthRefreshToken"');
  sqlite.run('drop table if exists pepys_revoked_grant');
  sqlite.run('drop table if exists pepys_grant_use');

  for (const table of ['oauthAccessToken', 'oauthRefreshToken']) {
    sqlite.run(
      `update "${table}" set "userId" = "authorizationCodeId", "sessionId" = null where "authorizationCodeId" in (select value from json_each(?))`,
      [grantIDs],
    );

    sqlite.run(
      `delete from "${table}" where "authorizationCodeId" is null or "authorizationCodeId" not in (select value from json_each(?))`,
      [grantIDs],
    );
  }

  // Each of these belonged to the owner, whose row goes with the old user table.
  sqlite.run('delete from session');
  sqlite.run('delete from "oauthConsent"');
  sqlite.run('delete from account');

  const userTable = { name: 'user', columns: [...userColumns, ...GRANT_COLUMNS], foreignKeys: [] };

  rebuildTable(sqlite, userTable, () => {
    writeGrantRows(sqlite, rows);
  });

  for (const table of CASCADING_TABLES) {
    const columns = readTableColumns(sqlite, table);

    const foreignKeys = [
      ...readForeignKeys(sqlite, table).filter((key) => key.from !== 'userId'),
      { from: 'userId', table: 'user', to: 'id', on_delete: 'CASCADE' },
    ];

    rebuildTable(sqlite, { name: table, columns, foreignKeys }, () => {
      const names = columns.map((column) => `"${column.name}"`).join(', ');

      sqlite.run(`insert into "${table}__next" (${names}) select ${names} from "${table}"`);
    });
  }

  const broken = sqlite.query('PRAGMA foreign_key_check').all();

  if (broken.length > 0) {
    throw new Error(
      `the grant migration left ${broken.length} rows whose foreign key points nowhere`,
    );
  }
}

const IndexListRowSchema = z.object({ name: z.string(), unique: z.number(), origin: z.string() });
const IndexColumnRowSchema = z.object({ name: z.string().nullable() });

const ColumnRowSchema = z.object({
  name: z.string(),
  type: z.string(),
  notnull: z.number(),
  dflt_value: z.string().nullable(),
  pk: z.number(),
});

function readTableColumns(sqlite: Database, table: string): TableColumn[] {
  const uniqueColumns = new Set(
    sqlite
      .query(`PRAGMA index_list("${table}")`)
      .all()
      .map((row) => IndexListRowSchema.parse(row))
      .filter((index) => index.unique === 1 && index.origin === 'u')
      .flatMap((index) => {
        const covered = sqlite
          .query(`PRAGMA index_info("${index.name}")`)
          .all()
          .map((row) => IndexColumnRowSchema.parse(row).name);

        return covered.length === 1 && covered[0] !== null && covered[0] !== undefined
          ? [covered[0]]
          : [];
      }),
  );

  return sqlite
    .query(`PRAGMA table_info("${table}")`)
    .all()
    .map((row) => ColumnRowSchema.parse(row))
    .map((column) => ({
      name: column.name,
      type: column.type,
      notnull: column.notnull,
      dflt_value: column.dflt_value,
      pk: column.pk,
      isUnique: uniqueColumns.has(column.name),
    }));
}

const TokenRowSchema = z.object({
  authorizationCodeId: z.string(),
  clientId: z.string(),
  scopes: z.string(),
  createdAt: z.string(),
  isLive: z.number(),
});

function readStoredTokens(sqlite: Database, at: string): StoredToken[] {
  return ['oauthAccessToken', 'oauthRefreshToken'].flatMap((table) =>
    sqlite
      .query(
        `select "authorizationCodeId", "clientId", scopes, "createdAt", (revoked is null and "expiresAt" > ?) as "isLive" from "${table}" where "authorizationCodeId" is not null`,
      )
      .all(at)
      .map((row) => TokenRowSchema.parse(row))
      .map((row) => ({
        grantID: toTagged<GrantID>(row.authorizationCodeId),
        clientID: toTagged<OAuthClientID>(row.clientId),
        scopes: row.scopes,
        createdAt: row.createdAt,
        isLive: row.isLive === 1,
      })),
  );
}

const GrantIDRowSchema = z.object({ grant_id: z.string() });

function readRevokedGrants(sqlite: Database): Set<GrantID> {
  if (!probeTable(sqlite, 'pepys_revoked_grant')) {
    return new Set();
  }

  return new Set(
    sqlite
      .query('select grant_id from pepys_revoked_grant')
      .all()
      .map((row) => toTagged<GrantID>(GrantIDRowSchema.parse(row).grant_id)),
  );
}

const NameRowSchema = z.object({ name: z.string() });

function probeTable(sqlite: Database, table: string): boolean {
  return (
    sqlite
      .query("select name from sqlite_master where type = 'table' and name = ?")
      .all(table)
      .map((row) => NameRowSchema.parse(row)).length > 0
  );
}

const GrantUseRowSchema = z.object({ grant_id: z.string(), last_used_at: z.string() });

function readGrantUses(sqlite: Database): Map<GrantID, string> {
  if (!probeTable(sqlite, 'pepys_grant_use')) {
    return new Map();
  }

  return new Map(
    sqlite
      .query('select grant_id, last_used_at from pepys_grant_use')
      .all()
      .map((row) => GrantUseRowSchema.parse(row))
      .map((row) => [toTagged<GrantID>(row.grant_id), row.last_used_at]),
  );
}

const IndexSQLRowSchema = z.object({ sql: z.string() });

// SQLite cannot change a column's key in place, so the table is made again
// under a new name, filled, and renamed over the old one, with its indexes.
interface RebuiltTable {
  readonly name: string;
  readonly columns: readonly TableColumn[];
  readonly foreignKeys: readonly TableForeignKey[];
}

function rebuildTable(sqlite: Database, table: RebuiltTable, writeRows: () => void): void {
  const indexes = sqlite
    .query(
      "select sql from sqlite_master where type = 'index' and tbl_name = ? and sql is not null",
    )
    .all(table.name)
    .map((row) => IndexSQLRowSchema.parse(row).sql);

  sqlite.run(buildTableSQL(`${table.name}__next`, table.columns, table.foreignKeys));

  writeRows();

  sqlite.run(`drop table "${table.name}"`);
  sqlite.run(`alter table "${table.name}__next" rename to "${table.name}"`);

  for (const index of indexes) {
    sqlite.run(index);
  }
}

function writeGrantRows(sqlite: Database, rows: readonly GrantRow[]): void {
  const insert = sqlite.prepare(
    'insert into "user__next" (id, name, email, "emailVerified", image, "createdAt", "updatedAt", "clientId", scopes, "approvedBy", limits, "lastUsedAt") values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );

  for (const row of rows) {
    insert.run(
      row.id,
      row.name,
      row.email,
      row.emailVerified,
      row.image,
      row.createdAt,
      row.updatedAt,
      row.clientId,
      row.scopes,
      row.approvedBy,
      row.limits,
      row.lastUsedAt,
    );
  }
}

const ForeignKeyRowSchema = z.object({
  from: z.string(),
  table: z.string(),
  to: z.string(),
  on_delete: z.string(),
});

function readForeignKeys(sqlite: Database, table: string): TableForeignKey[] {
  return sqlite
    .query(`PRAGMA foreign_key_list("${table}")`)
    .all()
    .map((row) => ForeignKeyRowSchema.parse(row));
}

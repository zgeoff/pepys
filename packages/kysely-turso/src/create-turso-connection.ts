import type { Database } from '@tursodatabase/database';
import type { CompiledQuery, DatabaseConnection, QueryResult } from 'kysely';

export function createTursoConnection(database: Database): DatabaseConnection {
  return {
    // Kysely's DatabaseConnection fixes this name
    // oxlint-disable-next-line zgeoff/function-verb
    executeQuery: (compiledQuery) => runQuery(database, compiledQuery),
    streamQuery: (compiledQuery) => streamRows(database, compiledQuery),
  };
}

async function runQuery<Row>(
  database: Database,
  compiledQuery: CompiledQuery,
): Promise<QueryResult<Row>> {
  const statement = await database.prepare(compiledQuery.sql);

  try {
    if (statement.reader) {
      const rows: unknown[] = await statement.all(...compiledQuery.parameters);

      return { rows: narrowRows<Row>(rows) };
    }

    const result = await statement.run(...compiledQuery.parameters);

    return {
      insertId: BigInt(result.lastInsertRowid),
      numAffectedRows: BigInt(result.changes),
      rows: [],
    };
  } finally {
    statement.close();
  }
}

// Kysely owns the row type: the caller's query builder declares it, and the driver only hands over
// what the database returned.
function narrowRows<Row>(rows: unknown[]): Row[] {
  return rows.filter((value): value is Row => value !== undefined);
}

async function* streamRows<Row>(
  database: Database,
  compiledQuery: CompiledQuery,
): AsyncIterableIterator<QueryResult<Row>> {
  const statement = await database.prepare(compiledQuery.sql);

  try {
    for await (const row of statement.iterate(...compiledQuery.parameters)) {
      const rows: unknown[] = [row];

      yield { rows: narrowRows<Row>(rows) };
    }
  } finally {
    statement.close();
  }
}

import type { CompiledQuery, DatabaseConnection, Dialect, QueryResult } from 'kysely';
import type { MCPAuthDatabase } from '../auth/mcp-auth-database.ts';

interface HookedAuthOpener {
  readonly openDatabase: (path: string) => MCPAuthDatabase;

  // Runs the work once, before the first query whose SQL matches the pattern,
  // and sends that query on when the work settles.
  readonly armBeforeQuery: (pattern: RegExp, interleave: () => Promise<void>) => void;
}

interface ArmedHook {
  readonly pattern: RegExp;
  readonly interleave: () => Promise<void>;
}

// Wraps an opener so a test can run another connection's work at an exact
// point between the queries of one request, as another process would.
export function buildHookedAuthOpener(open: (path: string) => MCPAuthDatabase): HookedAuthOpener {
  let armed: ArmedHook | null = null;

  const runArmedHook = async (query: string): Promise<void> => {
    if (armed === null || !armed.pattern.test(query)) {
      return;
    }

    const hook = armed;

    armed = null;

    await hook.interleave();
  };

  return {
    openDatabase: (path) => {
      const database = open(path);

      return { ...database, dialect: toHookedDialect(database.dialect, runArmedHook) };
    },
    armBeforeQuery: (pattern, interleave) => {
      armed = { pattern, interleave };
    },
  };
}

function toHookedDialect(dialect: Dialect, beforeQuery: (query: string) => Promise<void>): Dialect {
  return {
    ...dialect,
    createDriver: () => {
      const driver = dialect.createDriver();

      return {
        ...driver,
        acquireConnection: async () => {
          const connection = await driver.acquireConnection();

          return toHookedConnection(connection, beforeQuery);
        },
      };
    },
  };
}

function toHookedConnection(
  connection: DatabaseConnection,
  beforeQuery: (query: string) => Promise<void>,
): DatabaseConnection {
  return {
    ...connection,
    // oxlint-disable-next-line zgeoff/function-verb -- Kysely's DatabaseConnection interface fixes the method name
    async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
      await beforeQuery(compiledQuery.sql);

      return connection.executeQuery<R>(compiledQuery);
    },
  };
}

import type {
  CompiledQuery,
  DatabaseConnection,
  Dialect,
  DialectAdapter,
  Driver,
  QueryResult,
} from 'kysely';
import type { MCPAuthDatabase } from '../auth/mcp-auth-database.ts';

interface HookedAuthOpener {
  readonly openDatabase: (path: string) => MCPAuthDatabase;

  // Runs the work once, before the first query whose SQL matches the pattern,
  // and sends that query on when the work settles. The work runs before the
  // query takes the connection, so the opener's other queries go on meanwhile.
  readonly armBeforeQuery: (pattern: RegExp, interleave: () => Promise<void>) => void;
}

interface ArmedHook {
  readonly pattern: RegExp;
  readonly interleave: () => Promise<void>;
}

// Wraps an opener so a test can run other work at an exact point between the
// queries of one request: another connection's work, as another process
// would, or another request on the same server.
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

type BeforeQuery = (query: string) => Promise<void>;

// Kysely holds its own lock from each acquire to its release when the adapter
// reports one connection, so a hook that waits on another request would
// deadlock. The driver's own turn below keeps the queries one at a time.
function toHookedDialect(dialect: Dialect, beforeQuery: BeforeQuery): Dialect {
  return {
    ...dialect,
    createAdapter: () => toSharedAdapter(dialect.createAdapter()),
    createDriver: () => toHookedDriver(dialect.createDriver(), beforeQuery),
  };
}

function toSharedAdapter(adapter: DialectAdapter): DialectAdapter {
  return {
    // Kysely's own defaults for a flag an adapter leaves unset.
    supportsCreateIfNotExists: adapter.supportsCreateIfNotExists ?? true,
    supportsTransactionalDdl: adapter.supportsTransactionalDdl ?? false,
    supportsReturning: adapter.supportsReturning ?? false,
    supportsMultipleConnections: true,
    acquireMigrationLock: (db, options) => adapter.acquireMigrationLock(db, options),
    releaseMigrationLock: (db, options) => adapter.releaseMigrationLock(db, options),
  };
}

// Each acquire hands out a handle at once. The handle takes the driver's
// connection, and with it the driver's turn, only after the hook of its first
// query settles, and keeps it until Kysely releases the handle.
function toHookedDriver(driver: Driver, beforeQuery: BeforeQuery): Driver {
  const held = new WeakMap<DatabaseConnection, DatabaseConnection>();

  const acquireConnection = (): Promise<DatabaseConnection> => {
    const handle: DatabaseConnection = {
      // oxlint-disable-next-line zgeoff/function-verb -- Kysely's DatabaseConnection interface fixes the method name
      async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
        await beforeQuery(compiledQuery.sql);

        const connection = held.get(handle);

        if (connection !== undefined) {
          return connection.executeQuery<R>(compiledQuery);
        }

        const acquired = await driver.acquireConnection();

        held.set(handle, acquired);

        return acquired.executeQuery<R>(compiledQuery);
      },
      streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
        throw new Error('the hooked auth database does not stream queries');
      },
    };

    return Promise.resolve(handle);
  };

  const releaseConnection = async (handle: DatabaseConnection): Promise<void> => {
    const connection = held.get(handle);

    if (connection === undefined) {
      return;
    }

    held.delete(handle);

    await driver.releaseConnection(connection);
  };

  return { ...driver, acquireConnection, releaseConnection };
}

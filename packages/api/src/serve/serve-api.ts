import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { checkDeployment } from '@pepys/kit';
import type { Deployment } from '@pepys/kit';
import { makeShutdownHandler } from '@pepys/schema';
import { match } from 'ts-pattern';
import { createApp } from '../app/create-app.ts';
import { readAPIConfig } from '../config/read-api-config.ts';
import type { APIConfig, MCPConfig } from '../config/read-api-config.ts';
import { openMCPAuthDatabase } from '../oauth/admin/open-mcp-auth-database.ts';
import { runClients } from '../oauth/admin/run-clients.ts';
import { runGrants } from '../oauth/admin/run-grants.ts';
import { runPasskeys } from '../oauth/admin/run-passkeys.ts';
import { startMCPHTTPServer } from '../oauth/http/start-mcp-http-server.ts';
import { buildQueryContext } from '../queries/build-query-context.ts';
import type { QueryContext } from '../queries/types.ts';
import { createStoreReader } from '../store-reader/create-store-reader.ts';
import { parseAPIArguments } from './parse-api-arguments.ts';
import type { APICommand } from './parse-api-arguments.ts';

interface ServeAPIOptions {
  deployment: Deployment;
  environment: Readonly<Record<string, string | undefined>>;

  // absent or empty: serve; otherwise an admin command, such as `passkeys enroll`
  argv?: readonly string[];
}

// The API process of a deployment, or one admin command on the OAuth server's database. It exits
// 1 on bad arguments, a failed deployment check, a bad variable or a failed start.
export async function serveAPI(options: ServeAPIOptions): Promise<void> {
  const parsed = parseAPIArguments(options.argv ?? []);

  if (!parsed.ok) {
    console.error(parsed.failure);
    process.exit(1);
  }

  const command = parsed.value;

  if (command.kind !== 'serve') {
    try {
      await runAdminCommand(command, options.environment);
    } catch (error) {
      console.error(`${command.kind} failed`, error);
      process.exit(1);
    }

    return;
  }

  const checked = checkDeployment(options.deployment);

  if (!checked.ok) {
    console.error('the deployment fails its check', JSON.stringify(checked.failure));
    process.exit(1);
  }

  const config = readAPIConfig(options.environment);

  if (!config.ok) {
    console.error(config.failure.join('\n'));
    process.exit(1);
  }

  const store = createStoreReader({ storeDirectory: config.value.storeDirectory });
  const context = buildQueryContext(store, checked.value);
  let stopServer: () => Promise<void>;

  try {
    stopServer = await startServer(context, config.value);
  } catch (error) {
    console.error('the api failed to start', error);
    process.exit(1);
  }

  const shutdown = makeShutdownHandler({
    stop: async () => {
      await stopServer();

      await store.close();
    },
    logError,
    exit: (code) => process.exit(code),
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void shutdown();
    });
  }
}

type AdminCommand = Exclude<APICommand, { kind: 'serve' }>;

const AUTH_DB_FILE = 'mcp-auth.db';

function runAdminCommand(
  command: AdminCommand,
  environment: ServeAPIOptions['environment'],
): Promise<void> {
  const authDirectory = environment['PEPYS_AUTH_DIR'] ?? '';

  if (authDirectory === '') {
    console.error(`PEPYS_AUTH_DIR is not set, and ${command.kind} needs it`);
    process.exit(1);
  }

  const dbPath = join(authDirectory, AUTH_DB_FILE);

  return match(command)
    .with({ kind: 'passkeys' }, (passkeys) =>
      runPasskeys(passkeys.action, { dbPath, command: 'passkeys' }),
    )
    .with({ kind: 'clients' }, (clients) =>
      runClients(clients.action, { dbPath, command: 'clients' }),
    )
    .with({ kind: 'grants' }, (grants) => runGrants(grants.revoke, { dbPath, command: 'grants' }))
    .exhaustive();
}

async function startServer(context: QueryContext, config: APIConfig): Promise<() => Promise<void>> {
  if (config.mcp === null) {
    const app = createApp(context, { logError, oauth: null });

    app.listen({ hostname: config.host, port: config.port });
    console.log(`api listening on ${config.host}:${app.server?.port}`);

    return async () => {
      await app.stop();
    };
  }

  const server = await startOAuthServer(context, config, config.mcp);

  console.log(`api listening on ${server.listening}, serving /mcp at ${server.origin}/mcp`);

  return () => server.stop();
}

function logError(message: string, error: unknown): void {
  console.error(message, error);
}

function startOAuthServer(context: QueryContext, config: APIConfig, mcp: MCPConfig) {
  mkdirSync(mcp.authDirectory, { recursive: true });

  return startMCPHTTPServer({
    host: config.host,
    port: config.port,
    publicURL: mcp.publicURL,
    allowedHosts: mcp.allowedHosts,
    trustForwardedFrom: mcp.trustForwardedFrom,
    dbPath: join(mcp.authDirectory, AUTH_DB_FILE),
    openAuthDatabase: openMCPAuthDatabase,
    createServedApp: (oauth) => createApp(context, { logError, oauth }),

    // A log shipper matches the `pepys security ` prefix of these lines.
    printSecurity: (line) => {
      console.error(line);
    },
  });
}

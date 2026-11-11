import { checkDeployment } from '@pepys/kit';
import type { Deployment } from '@pepys/kit';
import { makeShutdownHandler } from '@pepys/schema';
import { createApp } from '../app/create-app.ts';
import { readAPIConfig } from '../config/read-api-config.ts';
import { buildQueryContext } from '../queries/build-query-context.ts';
import { createStoreReader } from '../store-reader/create-store-reader.ts';

interface ServeAPIOptions {
  deployment: Deployment;
  environment: Readonly<Record<string, string | undefined>>;
}

// The API process of a deployment: oRPC at /rpc and MCP at /mcp, on the listen address from the
// environment. It exits 1 at start on a failed deployment check or a bad variable.
export function serveAPI(options: ServeAPIOptions): void {
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
  const app = createApp(buildQueryContext(store, checked.value));

  app.listen({ hostname: config.value.host, port: config.value.port });
  console.log(`api listening on ${config.value.host}:${app.server?.port}`);

  const shutdown = makeShutdownHandler({
    stop: async () => {
      await app.stop();
      await store.close();
    },
    logError: (message, error) => {
      console.error(message, error);
    },
    exit: (code) => process.exit(code),
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void shutdown();
    });
  }
}

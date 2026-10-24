import { makeShutdownHandler } from '@pepys/schema';
import { githubPullRequestConsumer } from '@pepys/source-github';
import { createApp } from './create-app.ts';
import { createStoreReader } from './create-store-reader.ts';
import { openConsumerDatabase } from './open-consumer-database.ts';
import { readAPIConfig } from './read-api-config.ts';

const config = readAPIConfig(process.env);

if (!config.ok) {
  console.error(config.failure.join('\n'));
  process.exit(1);
}

const store = createStoreReader({
  storeDirectory: config.value.storeDirectory,
  openDatabase: openConsumerDatabase,
});

const app = createApp({ store, consumers: [githubPullRequestConsumer] });

app.listen({ hostname: '127.0.0.1', port: config.value.port });
console.log(`api listening on ${app.server?.port}`);

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

import { githubPullRequestConsumer } from '@pepys/source-github';
import { createApp } from './create-app.ts';
import { createStoreReader } from './create-store-reader.ts';
import { readAPIConfig } from './read-api-config.ts';

const config = readAPIConfig(process.env);

if (!config.ok) {
  console.error(config.failure.join('\n'));
  process.exit(1);
}

const store = createStoreReader(config.value.storeDirectory);
const app = createApp({ store, consumers: [githubPullRequestConsumer] });

app.listen({ hostname: '127.0.0.1', port: config.value.port });
console.log(`api listening on ${app.server?.port}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void shutdown();
  });
}

async function shutdown(): Promise<void> {
  await app.stop();
  await store.close();

  process.exit(0);
}

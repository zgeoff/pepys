import { createS2FactLog } from '@pepys/ingest';
import { makeShutdownHandler } from '@pepys/schema';
import { makeFactAppender } from './make-fact-appender.ts';
import { makeWebhookReceiver } from './make-webhook-receiver.ts';
import { pullRequestStream } from './pull-request-stream.ts';
import { readIngestConfig } from './read-ingest-config.ts';

const config = readIngestConfig(process.env);

if (!config.ok) {
  console.error(config.failure.join('\n'));
  process.exit(1);
}

const log = await createS2FactLog({
  endpoint: config.value.s2Endpoint,
  accessToken: config.value.s2AccessToken,
  basin: config.value.s2Basin,
  streams: [pullRequestStream],
});

const receiveWebhook = makeWebhookReceiver({
  secret: config.value.webhookSecret,
  appendFact: makeFactAppender({
    log,
    stream: pullRequestStream,
    maxAttempts: 5,
    retryDelayMs: 200,
  }),
});

const server = Bun.serve({
  port: config.value.port,
  routes: { '/webhook': receiveWebhook, '/*': () => new Response('not found', { status: 404 }) },
});

console.log(`ingest listening on ${server.port}`);

const shutdown = makeShutdownHandler({
  stop: () => server.stop(),
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

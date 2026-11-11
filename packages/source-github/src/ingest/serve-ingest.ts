import { createS2FactLog, makeBatchAppender } from '@pepys/ingest';
import { makeShutdownHandler } from '@pepys/schema';
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

const append = makeBatchAppender({ log, maxAttempts: 5, retryDelayMs: 200 });

// Two webhooks at once would spend their attempts on each other's tail mismatch, so each waits for
// the one before it.
let previous = Promise.resolve();

const receiveWebhook = makeWebhookReceiver({
  secret: config.value.webhookSecret,
  appendFact: async (fact) => {
    const turn = previous;
    const done = Promise.withResolvers<void>();

    previous = done.promise;

    try {
      await turn;

      const appended = await append(pullRequestStream, [fact]);

      if (!appended.ok) {
        throw new Error(`the fact is not stored: ${appended.failure.kind}`);
      }
    } finally {
      done.resolve();
    }
  },
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

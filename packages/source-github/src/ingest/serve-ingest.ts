import { createS2Stream } from './create-s2-stream.ts';
import { makeFactAppender } from './make-fact-appender.ts';
import { makeWebhookReceiver } from './make-webhook-receiver.ts';
import { pullRequestStream } from './pull-request-stream.ts';
import { readIngestConfig } from './read-ingest-config.ts';

const config = readIngestConfig(process.env);

if (!config.ok) {
  console.error(config.failure.join('\n'));
  process.exit(1);
}

const stream = await createS2Stream({
  endpoint: config.value.s2Endpoint,
  accessToken: config.value.s2AccessToken,
  basin: config.value.s2Basin,
  stream: pullRequestStream,
});

const receiveWebhook = makeWebhookReceiver({
  secret: config.value.webhookSecret,
  appendFact: makeFactAppender({ stream, maxAttempts: 5, retryDelayMs: 200 }),
});

const server = Bun.serve({
  port: config.value.port,
  routes: { '/webhook': receiveWebhook, '/*': () => new Response('not found', { status: 404 }) },
});

console.log(`ingest listening on ${server.port}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await server.stop();

    process.exit(0);
  });
}

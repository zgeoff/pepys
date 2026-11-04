import { runConformanceTests } from '@durable-streams/server-conformance-tests';

// vitest runs this file under Node, against the Bun server that run-spike.ts starts.
const baseUrl = process.env['CONFORMANCE_TEST_URL'];
const longPollTimeoutMs = Number(process.env['CONFORMANCE_LONG_POLL_TIMEOUT_MS']);

if (baseUrl === undefined) {
  throw new Error('run-spike.ts sets CONFORMANCE_TEST_URL');
}

runConformanceTests({ baseUrl, longPollTimeoutMs });

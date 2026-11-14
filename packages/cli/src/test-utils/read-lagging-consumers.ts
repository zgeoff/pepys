import { readOffsets } from '@pepys/api';
import type { StoreReader } from '@pepys/kit';
import { S2 } from '@s2-dev/streamstore';
import type { ReadConsumer } from '../../e2e/fixtures/e2e-read-consumers.ts';
import { collectLaggingConsumers } from './collect-lagging-consumers.ts';

interface S2Access {
  s2Endpoint: string;
  s2AccessToken: string;
  s2Basin: string;
}

// The name of each of `consumers` that has not applied the tail of its stream on s2-lite.
export async function readLaggingConsumers(
  store: StoreReader,
  s2: S2Access,
  consumers: readonly ReadConsumer[],
): Promise<string[]> {
  const client = new S2({
    accessToken: s2.s2AccessToken,
    endpoints: { account: s2.s2Endpoint, basin: s2.s2Endpoint },
  });

  const tails = new Map<string, number>();

  for (const stream of new Set(consumers.map((entry) => entry.stream))) {
    const response = await client.basin(s2.s2Basin).stream(stream).checkTail();

    tails.set(stream, response.tail.seqNum);
  }

  const read = [];

  for (const entry of consumers) {
    const offsets = await readOffsets(store, entry.consumer);

    read.push({
      name: entry.consumer.name,
      stream: entry.stream,
      offsets: offsets.ok ? offsets.value : null,
    });
  }

  return collectLaggingConsumers(read, tails);
}

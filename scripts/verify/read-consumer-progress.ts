import { createStoreReader, readOffsets } from '@pepys/api';
import type { ConsumerDeclaration } from '@pepys/kit';
import { S2 } from '@s2-dev/streamstore';
import type { RunEndpoints } from './parse-run-endpoints.ts';

export interface ConsumerProgress {
  consumer: string;
  stream: string;

  // the last sequence number the consumer applied from the stream, or null before its first
  appliedThrough: number | null;

  // the sequence number s2-lite gives the stream's next fact
  tail: number;
}

// How far the consumer has read the stream: its saved offset in the store, and the stream's tail.
export async function readConsumerProgress(
  run: RunEndpoints,
  consumer: ConsumerDeclaration,
  stream: string,
): Promise<ConsumerProgress> {
  const store = createStoreReader({ storeDirectory: run.store });

  try {
    const offsets = await readOffsets(store, consumer);

    const client = new S2({
      accessToken: run.s2Token,
      endpoints: { account: run.s2, basin: run.s2 },
    });

    const checked = await client.basin(run.s2Basin).stream(stream).checkTail();

    const saved = offsets.ok ? offsets.value.find((offset) => offset.stream === stream) : undefined;

    return {
      consumer: consumer.name,
      stream,
      appliedThrough: saved?.lastSeqNum ?? null,
      tail: checked.tail.seqNum,
    };
  } finally {
    await store.close();
  }
}

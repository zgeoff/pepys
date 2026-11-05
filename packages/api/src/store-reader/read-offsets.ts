import type { Result } from '@pepys/schema';
import type { StoreReader } from './store-reader.ts';

interface Offset {
  stream: string;
  lastSeqNum: number;
}

export async function readOffsets(
  store: StoreReader,
  consumerName: string,
): Promise<Result<Offset[], { reason: 'no-current-version' }>> {
  const result = await store.withConsumer(consumerName, (transaction) =>
    transaction
      .selectFrom('offsets')
      .select(['stream', 'last_seq_num'])
      .orderBy('stream')
      .execute(),
  );

  if (!result.ok) {
    return result;
  }

  const offsets = result.value.map((row) => ({ stream: row.stream, lastSeqNum: row.last_seq_num }));

  return { ok: true, value: offsets };
}

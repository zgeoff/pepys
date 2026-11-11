import type { ConsumerDeclaration, Result, StoreReader, StoreReaderFailure } from '@pepys/kit';
import { sql } from 'kysely';
import { z } from 'zod';

interface Offset {
  stream: string;
  lastSeqNum: number;
}

const offsetRowSchema = z.object({ stream: z.string(), last_seq_num: z.number() });
const offsetRowsSchema = z.object({ rows: z.array(offsetRowSchema) });

// The last sequence number the host applied from each stream the consumer reads.
export async function readOffsets(
  store: StoreReader,
  consumer: ConsumerDeclaration,
): Promise<Result<Offset[], StoreReaderFailure>> {
  const table = sql.table(`${consumer.name}.offsets`);

  const result = await store.withConsumers([consumer], (db) =>
    sql`select stream, last_seq_num from ${table} order by stream`.execute(db),
  );

  if (!result.ok) {
    return result;
  }

  const offsets = offsetRowsSchema
    .parse(result.value)
    .rows.map((row) => ({ stream: row.stream, lastSeqNum: row.last_seq_num }));

  return { ok: true, value: offsets };
}

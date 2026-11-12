import type {
  ConsumerDeclaration,
  Result,
  StoreReader,
  StoreReaderFailure,
  StreamName,
} from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import { sql } from 'kysely';
import { z } from 'zod';

interface Offset {
  stream: StreamName;
  lastSeqNum: number;
}

// the host writes each offset under the name of a stream the consumer reads
const offsetRowSchema = z.object({
  stream: z.string().transform((text) => toTagged<StreamName>(text)),
  last_seq_num: z.number(),
});

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

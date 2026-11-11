import type { DB, Result } from '@pepys/schema';
import type { Transaction } from 'kysely';

interface EntityViewRow {
  id: string;
  kind: string;
  title: string;
  url: string;
  actor: string | null;
  updated_at: string;
}

// the host creates these two tables in every consumer file, beside the consumer's own
interface OffsetRow {
  stream: string;
  last_seq_num: number;
}

interface ChangeLogRow {
  batch: number;
  changes: string;
}

export type ConsumerDB = DB & {
  entity: EntityViewRow;
  offsets: OffsetRow;
  change_log: ChangeLogRow;
};

export interface StoreReader {
  withConsumer: <Value>(
    consumerName: string,
    work: (transaction: Transaction<ConsumerDB>) => Promise<Value>,
  ) => Promise<Result<Value, { reason: 'no-current-version' }>>;
  close: () => Promise<void>;
}

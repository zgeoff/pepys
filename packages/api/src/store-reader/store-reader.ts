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

export type ConsumerDB = DB & { entity: EntityViewRow };

export interface StoreReader {
  withConsumer: <Value>(
    consumerName: string,
    work: (transaction: Transaction<ConsumerDB>) => Promise<Value>,
  ) => Promise<Result<Value, { reason: 'no-current-version' }>>;
  close: () => Promise<void>;
}

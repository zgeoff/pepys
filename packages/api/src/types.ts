import type { InferSchemaInput, InferSchemaOutput, RouterClient, Schema } from '@orpc/server';
import type { ConsumerDeclaration, DB, Result } from '@pepys/schema';
import type { Transaction } from 'kysely';
import type { createRouter } from './create-router.ts';

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
  withConsumer: <Result>(
    consumerName: string,
    work: (transaction: Transaction<ConsumerDB>) => Promise<Result>,
  ) => Promise<Result>;
  close: () => Promise<void>;
}

export interface QueryContext {
  store: StoreReader;
  consumers: readonly ConsumerDeclaration[];
}

interface QueryFailure {
  code: 'NOT_FOUND';
  message: string;
}

export interface RegisteredQuery<
  Input extends Schema<unknown, unknown>,
  Output extends Schema<unknown, unknown>,
> {
  name: string;
  description: string;
  input: Input;
  output: Output;
  run: (
    context: QueryContext,
    input: InferSchemaOutput<Input>,
  ) => Promise<Result<InferSchemaInput<Output>, QueryFailure>>;
}

export type APIClient = RouterClient<ReturnType<typeof createRouter>>;

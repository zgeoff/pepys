import type { InferSchemaInput, InferSchemaOutput, Schema } from '@orpc/server';
import type { ConsumerDeclaration, Result } from '@pepys/schema';
import type { StoreReader } from '../store-reader/store-reader.ts';

export interface QueryContext {
  store: StoreReader;
  consumers: readonly ConsumerDeclaration[];
}

interface QueryFailure {
  code: 'NOT_FOUND';
  message: string;
}

export interface RegisteredQuery<
  Name extends string,
  Input extends Schema<unknown, unknown>,
  Output extends Schema<unknown, unknown>,
> {
  name: Name;
  description: string;
  input: Input;
  output: Output;
  run: (
    context: QueryContext,
    input: InferSchemaOutput<Input>,
  ) => Promise<Result<InferSchemaInput<Output>, QueryFailure>>;
}

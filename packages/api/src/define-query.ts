import type { Schema } from '@orpc/server';
import type { RegisteredQuery } from './types.ts';

export function defineQuery<
  Input extends Schema<unknown, unknown>,
  Output extends Schema<unknown, unknown>,
>(query: RegisteredQuery<Input, Output>): RegisteredQuery<Input, Output> {
  return query;
}

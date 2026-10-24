import type { Schema } from '@orpc/server';
import type { RegisteredQuery } from './types.ts';

export function defineQuery<
  const Name extends string,
  Input extends Schema<unknown, unknown>,
  Output extends Schema<unknown, unknown>,
>(query: RegisteredQuery<Name, Input, Output>): RegisteredQuery<Name, Input, Output> {
  return query;
}

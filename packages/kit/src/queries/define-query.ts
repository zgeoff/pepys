import type { z } from 'zod';
import type { ConsumerDeclaration } from '../consumers/types.ts';
import type { QueryDefinition } from './types.ts';

export function defineQuery<
  const Name extends string,
  InputSchema extends z.ZodType,
  OutputSchema extends z.ZodType,
  const Consumers extends readonly ConsumerDeclaration[],
>(
  query: QueryDefinition<Name, InputSchema, OutputSchema, Consumers>,
): QueryDefinition<Name, InputSchema, OutputSchema, Consumers> {
  return query;
}

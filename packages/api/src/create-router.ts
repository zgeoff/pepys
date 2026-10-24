import { ORPCError, os } from '@orpc/server';
import type { Schema } from '@orpc/server';
import { getEntityQuery } from './get-entity-query.ts';
import type { QueryContext, RegisteredQuery } from './types.ts';

export function createRouter() {
  return { [getEntityQuery.name]: registerQuery(getEntityQuery) };
}

function registerQuery<
  Name extends string,
  Input extends Schema<unknown, unknown>,
  Output extends Schema<unknown, unknown>,
>(query: RegisteredQuery<Name, Input, Output>) {
  return os
    .$context<QueryContext>()
    .route({ summary: query.name, description: query.description })
    .input(query.input)
    .output(query.output)
    .handler(async (options) => {
      const result = await query.run(options.context, options.input);

      if (!result.ok) {
        throw new ORPCError(result.failure.code, { message: result.failure.message });
      }

      return result.value;
    });
}

import { z } from 'zod';
import type { QueryDefinition } from '../queries/types.ts';

// A query that reads no consumer and answers an empty object, beside the fields a test gives.
export function buildStubQuery(
  fields: Partial<QueryDefinition> & Pick<QueryDefinition, 'name'>,
): QueryDefinition {
  return {
    description: 'A stub query.',
    input: z.object({}),
    output: z.object({}),
    reads: [],
    handler: () => Promise.resolve({}),
    ...fields,
  };
}

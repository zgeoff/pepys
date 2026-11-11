import type { ConsumerDeclaration } from '../consumers/types.ts';

// A consumer with no input stream, no table and no link, beside the fields a test gives.
export function buildStubConsumer(
  fields: Partial<ConsumerDeclaration> & Pick<ConsumerDeclaration, 'name'>,
): ConsumerDeclaration {
  return {
    entry: new URL('file:///stub/consumers/stub.ts'),
    input: { mode: 'fact', streams: [] },
    tables: {},
    entityViews: [],
    reads: [],
    links: [],
    ...fields,
  };
}

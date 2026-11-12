import type { ConsumerDeclaration } from '../consumers/types.ts';

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

import type {
  AnyQueryDefinition,
  QueryDefinition,
  Result,
  StoreReader,
  StoreReaderFailure,
} from '@pepys/kit';

// Runs one plug-in query's handler on the files of the consumers it reads. The router has parsed
// `input` with the query's own input schema, and parses the answer with its output schema.
export async function runPluginQuery(
  store: StoreReader,
  query: AnyQueryDefinition,
  input: unknown,
): Promise<Result<unknown, StoreReaderFailure>> {
  const handler: unknown = query.handler;

  if (!isQueryHandler(handler)) {
    throw new TypeError(`the query ${query.name} has no handler`);
  }

  const result = await store.withConsumers(query.reads, (db) => handler({ input, db }));

  return result;
}

// A list of queries types each handler's call as `never`, since no one call type fits every
// handler. Each handler takes the call that its own input schema parses, which the router gives.
function isQueryHandler(handler: unknown): handler is QueryDefinition['handler'] {
  return typeof handler === 'function';
}

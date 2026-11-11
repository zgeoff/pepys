import type { Result } from '@pepys/kit';
import { z } from 'zod';
import type { StoreReader } from './store-reader.ts';

interface ChangeOperation {
  key: string;
  operation: string;
}

// each change log row holds one batch as a JSON list of State Protocol messages
const headersSchema = z.object({ operation: z.string() });
const changesSchema = z.array(z.object({ key: z.string(), headers: headersSchema }));

export async function readChangeOperations(
  store: StoreReader,
  consumerName: string,
): Promise<Result<ChangeOperation[], { reason: 'no-current-version' }>> {
  const result = await store.withConsumer(consumerName, (transaction) =>
    transaction.selectFrom('change_log').select('changes').orderBy('batch').execute(),
  );

  if (!result.ok) {
    return result;
  }

  const operations = result.value.flatMap((row) => {
    const changes: unknown = JSON.parse(row.changes);

    return changesSchema
      .parse(changes)
      .map((change) => ({ key: change.key, operation: change.headers.operation }));
  });

  return { ok: true, value: operations };
}

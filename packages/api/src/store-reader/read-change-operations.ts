import type { ConsumerDeclaration, Result, StoreReader, StoreReaderFailure } from '@pepys/kit';
import { sql } from 'kysely';
import { z } from 'zod';

interface ChangeOperation {
  key: string;
  operation: string;
}

const changeLogRowSchema = z.object({ changes: z.string() });
const changeLogRowsSchema = z.object({ rows: z.array(changeLogRowSchema) });

const changeSchema = z.object({
  key: z.string(),
  headers: z.object({ operation: z.string() }),
});

// each change log row holds one batch as a JSON list of State Protocol messages
const changesSchema = z.array(changeSchema);

export async function readChangeOperations(
  store: StoreReader,
  consumer: ConsumerDeclaration,
): Promise<Result<ChangeOperation[], StoreReaderFailure>> {
  const table = sql.table(`${consumer.name}.change_log`);

  const result = await store.withConsumers([consumer], (db) =>
    sql`select changes from ${table} order by batch`.execute(db),
  );

  if (!result.ok) {
    return result;
  }

  const operations = changeLogRowsSchema.parse(result.value).rows.flatMap((row) => {
    const changes: unknown = JSON.parse(row.changes);

    return changesSchema
      .parse(changes)
      .map((change) => ({ key: change.key, operation: change.headers.operation }));
  });

  return { ok: true, value: operations };
}

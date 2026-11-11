import type { CoreOutputs } from '@pepys/contract';
import { parseEntityID } from '@pepys/kit';
import type { Result } from '@pepys/kit';
import { sql } from 'kysely';
import invariant from 'tiny-invariant';
import { z } from 'zod';
import type { QueryContext, QueryFailure } from '../types.ts';
import { buildEntityRow } from './build-entity-row.ts';

const storedRowSchema = z.record(z.string(), z.unknown());
const storedRowsSchema = z.object({ rows: z.array(storedRowSchema) });

type EntityOutput = CoreOutputs['get_entity'];

// The kind in the ID names the owning consumer, so the call attaches that one file.
export async function readEntity(
  context: QueryContext,
  id: string,
): Promise<Result<EntityOutput, QueryFailure>> {
  const parsed = parseEntityID(id);

  if (!parsed.ok) {
    return {
      ok: false,
      failure: {
        code: 'BAD_REQUEST',
        message: `${id} is not an entity ID: ${parsed.failure.reason}`,
      },
    };
  }

  const notFound = {
    ok: false,
    failure: { code: 'NOT_FOUND', message: `no entity ${id}` },
  } as const;

  const owner = context.entityKinds.get(`${parsed.value.source}:${parsed.value.kind}`);

  if (owner === undefined) {
    return notFound;
  }

  const read = await context.store.withConsumers([owner.consumer], async (db) => {
    const entity = await db
      .selectFrom('entity')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    if (entity === undefined) {
      return null;
    }

    // the names come from the declaration, never from the input
    const table = sql.table(owner.view.table);
    const idColumn = sql.ref(owner.view.id);

    const result = await sql`select * from ${table} where ${idColumn} = ${id}`.execute(db);

    const [stored] = storedRowsSchema.parse(result).rows;
    const declaration = owner.consumer.tables[owner.view.table];

    invariant(stored !== undefined && declaration !== undefined, 'an entity row has a table row');

    const value: EntityOutput = {
      entity,
      consumer: owner.consumer.name,
      table: owner.view.table,
      row: buildEntityRow(declaration, stored),
    };

    return value;
  });

  if (!read.ok) {
    return {
      ok: false,
      failure: {
        code: 'SERVICE_UNAVAILABLE',
        message: `the consumer ${read.failure.consumers.join(', ')} has no current version`,
      },
    };
  }

  return read.value === null ? notFound : { ok: true, value: read.value };
}

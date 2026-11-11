import type { CoreOutputs } from '@pepys/contract';
import type { EntityID, EntityIDParts, Result } from '@pepys/kit';
import { sql } from 'kysely';
import invariant from 'tiny-invariant';
import { z } from 'zod';
import type { QueryContext, QueryFailure } from '../types.ts';
import { buildEntityRow } from './build-entity-row.ts';
import { findEntityConsumer } from './find-entity-consumer.ts';

const storedRowSchema = z.record(z.string(), z.unknown());
const storedRowsSchema = z.object({ rows: z.array(storedRowSchema) });

interface ParsedEntityID {
  id: EntityID;
  parts: EntityIDParts;
}

export async function readEntity(
  context: QueryContext,
  parsed: ParsedEntityID,
): Promise<Result<CoreOutputs['get_entity'], QueryFailure>> {
  const id = parsed.id;

  const notFound = {
    ok: false,
    failure: { code: 'NOT_FOUND', message: `no entity ${id}` },
  } as const;

  const found = findEntityConsumer(context.consumers, parsed.parts);

  if (found === undefined) {
    return notFound;
  }

  const read = await context.store.withConsumer(found.consumer.name, async (transaction) => {
    const entity = await transaction
      .selectFrom('entity')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    if (entity === undefined) {
      return notFound;
    }

    const table = sql.table(found.entityView.table);
    const idColumn = sql.ref(found.entityView.id);
    const query = sql`select * from ${table} where ${idColumn} = ${id}`;

    const result = await query.execute(transaction);

    const [stored] = storedRowsSchema.parse(result).rows;
    const declaration = found.consumer.tables[found.entityView.table];

    invariant(
      stored !== undefined && declaration !== undefined,
      'an entity view row has a table row',
    );

    const value: CoreOutputs['get_entity'] = {
      entity,
      row: buildEntityRow(declaration, stored),
      aliases: [],
    };

    return { ok: true, value } as const;
  });

  return read.ok ? read.value : notFound;
}

import { parseEntityID } from '@pepys/schema';
import { sql } from 'kysely';
import invariant from 'tiny-invariant';
import { z } from 'zod';
import { buildEntityRow } from './build-entity-row.ts';
import { defineQuery } from './define-query.ts';
import { findEntityConsumer } from './find-entity-consumer.ts';

const entityIDSchema = z.string().transform((text, ctx) => {
  const parsed = parseEntityID(text);

  if (!parsed.ok) {
    const message = `not an entity ID: ${parsed.failure.reason}`;

    ctx.issues.push({ code: 'custom', message, input: text });

    return z.NEVER;
  }

  return { text, parts: parsed.value };
});

const entitySchema = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
  url: z.string(),
  actor: z.string().nullable(),
  updated_at: z.string(),
});

const rowSchema = z.record(z.string(), z.unknown());
const storedRowsSchema = z.object({ rows: z.array(rowSchema) });

export const getEntityQuery = defineQuery({
  name: 'get_entity',
  description:
    "Returns one entity by its ID, such as github:pr:1874433021: its row in the owning consumer's entity view, and its full row.",
  input: z.object({ id: entityIDSchema }),
  output: z.object({ entity: entitySchema, row: rowSchema }),
  run: (context, input) => {
    const notFound = {
      ok: false,
      failure: { code: 'NOT_FOUND', message: `no entity ${input.id.text}` },
    } as const;

    const found = findEntityConsumer(context.consumers, input.id.parts);

    if (found === undefined) {
      return Promise.resolve(notFound);
    }

    return context.store.withConsumer(found.consumer.name, async (transaction) => {
      const entity = await transaction
        .selectFrom('entity')
        .selectAll()
        .where('id', '=', input.id.text)
        .executeTakeFirst();

      if (entity === undefined) {
        return notFound;
      }

      const table = sql.table(found.entityView.table);
      const idColumn = sql.ref(found.entityView.id);
      const query = sql`select * from ${table} where ${idColumn} = ${input.id.text}`;

      const result = await query.execute(transaction);

      const [stored] = storedRowsSchema.parse(result).rows;
      const declaration = found.consumer.tables[found.entityView.table];

      invariant(
        stored !== undefined && declaration !== undefined,
        'an entity view row has a table row',
      );

      return { ok: true, value: { entity, row: buildEntityRow(declaration, stored) } };
    });
  },
});

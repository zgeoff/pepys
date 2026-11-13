import type { CoreOutputs } from '@pepys/contract';
import { isEntityID, parseEntityID } from '@pepys/kit';
import type { ConsumerDeclaration, EntityID, EntityIDParts, Result } from '@pepys/kit';
import { sql } from 'kysely';
import invariant from 'tiny-invariant';
import { z } from 'zod';
import type { QueryContext, QueryFailure } from '../types.ts';
import { buildEntityRow } from './build-entity-row.ts';

type EntityOutput = CoreOutputs['get_entity'];

type EntityRead = Result<EntityOutput, QueryFailure>;

// Text that parses as an entity ID is an ID, and any other text is an alias.
export async function readEntity(context: QueryContext, text: string): Promise<EntityRead> {
  const notFound = {
    ok: false,
    failure: { code: 'NOT_FOUND', message: `no entity ${text}` },
  } as const;

  const parsed = parseEntityID(text);

  if (parsed.ok) {
    invariant(isEntityID(text), 'text that parses as an entity ID is one');

    return readEntityByID(context, text, parsed.value, notFound);
  }

  const resolved = await readAliasEntityID(context, text);

  if (!resolved.ok) {
    return resolved.failure === null ? notFound : { ok: false, failure: resolved.failure };
  }

  const resolvedParts = parseEntityID(resolved.value);

  if (!resolvedParts.ok || !isEntityID(resolved.value)) {
    return notFound;
  }

  return readEntityByID(context, resolved.value, resolvedParts.value, notFound);
}

const storedRowSchema = z.record(z.string(), z.unknown());
const storedRowsSchema = z.object({ rows: z.array(storedRowSchema) });

// The kind in the ID names the owning consumer, so the call attaches that one file.
async function readEntityByID(
  context: QueryContext,
  id: EntityID,
  parts: EntityIDParts,
  notFound: EntityRead,
): Promise<EntityRead> {
  const owner = context.entityKinds.get(`${parts.source}:${parts.kind}`);

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
    return { ok: false, failure: buildUnavailableFailure(read.failure.consumers) };
  }

  return read.value === null ? notFound : { ok: true, value: read.value };
}

function buildUnavailableFailure(consumers: readonly string[]): QueryFailure {
  return {
    code: 'SERVICE_UNAVAILABLE',
    message: `the consumer ${consumers.join(', ')} has no current version`,
  };
}

const aliasRowSchema = z.object({ entity_id: z.string() });
const aliasRowsSchema = z.object({ rows: z.array(aliasRowSchema) });

// The entity ID that an alias names, from the `<table>_alias` table beside each entity view's
// table. A miss is a null failure. A miss while an alias consumer has no current version is a
// SERVICE_UNAVAILABLE failure, because that consumer may hold the alias.
async function readAliasEntityID(
  context: QueryContext,
  text: string,
): Promise<Result<string, QueryFailure | null>> {
  const tables = collectAliasTables(context.deployment.consumers);
  const alias = toAliasKey(text);

  const read = await context.store.withConsumers(
    [],
    async (db, call) => {
      const attached = tables.filter((table) => !call.skipped.includes(table.consumer.name));

      for (const aliasTable of attached) {
        // the table name comes from the declaration, never from the input
        const table = sql.table(aliasTable.table);

        const result = await sql`select entity_id from ${table} where alias = ${alias}`.execute(db);

        const [row] = aliasRowsSchema.parse(result).rows;

        if (row !== undefined) {
          return { entityID: row.entity_id, skipped: call.skipped };
        }
      }

      return { entityID: null, skipped: call.skipped };
    },
    { whenCurrent: tables.map((table) => table.consumer) },
  );

  invariant(read.ok, 'a call with only optional consumers always runs');

  if (read.value.entityID !== null) {
    return { ok: true, value: read.value.entityID };
  }

  if (read.value.skipped.length > 0) {
    return { ok: false, failure: buildUnavailableFailure(read.value.skipped) };
  }

  return { ok: false, failure: null };
}

interface AliasTable {
  consumer: ConsumerDeclaration;
  table: string;
}

function collectAliasTables(consumers: readonly ConsumerDeclaration[]): AliasTable[] {
  return consumers.flatMap((consumer) =>
    consumer.entityViews
      .map((view) => `${view.table}_alias`)
      .filter((table) => Object.hasOwn(consumer.tables, table))
      .map((table) => ({ consumer, table })),
  );
}

// A consumer writes each alias in this form, so `Acme/API#412 ` and `acme/api#412` name one entity.
function toAliasKey(text: string): string {
  const trimmed = text.trim().toLowerCase();

  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

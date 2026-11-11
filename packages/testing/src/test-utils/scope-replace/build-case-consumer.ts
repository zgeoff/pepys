import { defineTable } from '@pepys/kit';
import type { ConsumerDeclaration } from '@pepys/kit';
import { z } from 'zod';

const columnKindSchema = z.enum([
  'text',
  'integer',
  'real',
  'boolean',
  'json',
  'entityID',
  'timestamp',
]);

const columnSchema = z.object({ kind: columnKindSchema, nullable: z.boolean() });
const columnListSchema = z.array(z.string());

const tableSchema = z.object({
  columns: z.record(z.string(), columnSchema),
  primaryKey: columnListSchema,
  indexes: z.array(columnListSchema),
});

const entityKindSchema = z.templateLiteral([z.string(), ':', z.string()]);
const streamSchema = z.templateLiteral(['facts.', z.string(), '.', z.string()]);

const inputSchema = z.object({
  mode: z.literal('scope'),
  scopeKind: entityKindSchema,
  streams: z.array(streamSchema),
});

const linkSchema = z.object({
  name: z.string(),
  from: z.array(entityKindSchema),
  to: z.array(entityKindSchema),
  hub: z.boolean(),
});

const caseConsumerSchema = z.object({
  name: z.string(),
  input: inputSchema,
  tables: z.record(z.string(), tableSchema),
  links: z.array(linkSchema),
});

// The consumer of the scope replace case file, which holds its tables in the manifest's form. Its
// entry is never loaded: the cases give each module output as text.
export function buildCaseConsumer(declared: unknown): ConsumerDeclaration {
  const consumer = caseConsumerSchema.parse(declared);

  return {
    name: consumer.name,
    entry: new URL('file:///scope-replace-cases/entry.ts'),
    input: consumer.input,
    tables: Object.fromEntries(
      Object.entries(consumer.tables).map(([name, table]) => [name, toTable(table)]),
    ),
    entityViews: [],
    reads: [],
    links: consumer.links,
  };
}

function toTable(table: z.output<typeof tableSchema>): ReturnType<typeof defineTable> {
  const indexes = table.indexes.map((columns) => ({ columns }));

  return defineTable({ columns: table.columns, primaryKey: table.primaryKey, indexes });
}

import type { VersionHash } from '@pepys/kit';
import { match } from 'ts-pattern';
import { z } from 'zod';
import type {
  ConsumerBuildManifest,
  ConsumerManifest,
  ListedConsumer,
  ManifestTable,
} from './types.ts';

// The host keeps these tables in every consumer's file.
const reservedTableNames = new Set([
  'link',
  'entity',
  'offsets',
  'change_log',
  'applied_facts',
  'scope_row',
]);

const hashSchema = z.custom<VersionHash>(
  (value) => typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value),
  'expected a SHA-256 as 64 lowercase hex digits',
);

const nameSchema = z.string().min(1);
const symbolSchema = z.string().min(1);
const streamSchema = z.templateLiteral(['facts.', z.string(), '.', z.string()]);
const entityKindSchema = z.templateLiteral([z.string(), ':', z.string()]);

const inputSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('fact'), streams: z.array(streamSchema).min(1) }),
  z.strictObject({
    mode: z.literal('scope'),
    scopeKind: entityKindSchema,
    streams: z.array(streamSchema).min(1),
  }),
]);

const readSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('row'),
    table: nameSchema,
    length: symbolSchema,
    into: symbolSchema,
  }),
  z.strictObject({ kind: z.literal('scope_facts'), length: symbolSchema, into: symbolSchema }),
]);

const columnSchema = z.strictObject({
  kind: z.enum(['text', 'integer', 'real', 'boolean', 'json', 'entityID', 'timestamp']),
  nullable: z.boolean(),
});

const tableSchema = z.strictObject({
  columns: z.record(nameSchema, columnSchema),
  primaryKey: z.array(nameSchema).min(1),
  indexes: z.array(z.array(nameSchema).min(1)),
});

const linkTypeSchema = z.strictObject({
  name: nameSchema,
  from: z.array(entityKindSchema).min(1),
  to: z.array(entityKindSchema).min(1),
  hub: z.boolean(),
});

const manifestSchema = z
  .strictObject({
    name: nameSchema,
    input: inputSchema,
    exports: z.strictObject({ init: symbolSchema, apply: symbolSchema }),
    imports: z.array(readSchema),
    tables: z.record(nameSchema, tableSchema),
    links: z.array(linkTypeSchema),
    schema: z.string().min(1),
  })
  .superRefine((manifest, ctx) => {
    for (const message of collectManifestProblems(manifest)) {
      ctx.addIssue({ code: 'custom', message });
    }
  });

const listedConsumerSchema = z
  .strictObject({
    name: nameSchema,
    module: hashSchema,
    path: z
      .string()
      .min(1)
      .refine(
        (path) => !path.startsWith('/') && !path.split('/').includes('..'),
        'expected a path inside the folder of consumers.json',
      ),
    pins: z.record(nameSchema, hashSchema),
    version: hashSchema,
    manifest: manifestSchema,
  })
  .refine(
    (consumer) => consumer.name === consumer.manifest.name,
    'expected the name of the entry to equal the name of its manifest',
  );

// Strict at every level: a field that this schema does not know fails the parse, so a file from a
// newer build fails at once. The Rust host gives the same verdict on each case of the case file.
export const consumerBuildManifestSchema = z
  .strictObject({
    kit: z.literal(1),
    deployment: nameSchema.nullable(),
    consumers: z.array(listedConsumerSchema),
  })
  .superRefine((file, ctx) => {
    for (const message of collectFileProblems(file.consumers)) {
      ctx.addIssue({ code: 'custom', message });
    }
  }) satisfies z.ZodType<ConsumerBuildManifest>;

function collectManifestProblems(manifest: ConsumerManifest): string[] {
  const symbols = [
    manifest.exports.init,
    manifest.exports.apply,
    ...manifest.imports.flatMap((read) => [read.length, read.into]),
  ];

  return [
    ...collectReadProblems(manifest),
    ...collectRepeats(manifest.links.map((link) => link.name)).map(
      (name) => `the link type ${name} is declared twice`,
    ),
    ...collectRepeats(symbols).map((symbol) => `the symbol ${symbol} is used twice`),
    ...Object.entries(manifest.tables).flatMap(([name, table]) =>
      collectTableProblems(name, table),
    ),
  ];
}

function collectReadProblems(manifest: ConsumerManifest): string[] {
  return match(manifest.input.mode)
    .with('scope', () => {
      const [read, ...others] = manifest.imports;

      return read?.kind === 'scope_facts' && others.length === 0
        ? []
        : ['a scope consumer has exactly one read, of kind scope_facts'];
    })
    .with('fact', () =>
      manifest.imports.flatMap((read) =>
        match(read)
          .with({ kind: 'scope_facts' }, () => ['a fact consumer reads rows only'])
          .with({ kind: 'row' }, (row) =>
            row.table in manifest.tables
              ? []
              : [`the row read names ${row.table}, which is no table of the consumer`],
          )
          .exhaustive(),
      ),
    )
    .exhaustive();
}

function collectRepeats(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const repeats = new Set<string>();

  for (const value of values) {
    if (seen.has(value)) {
      repeats.add(value);
    }

    seen.add(value);
  }

  return [...repeats];
}

function collectTableProblems(name: string, table: ManifestTable): string[] {
  const columns = [...table.primaryKey, ...table.indexes.flat()];

  const missing = columns
    .filter((column) => !(column in table.columns))
    .map((column) => `the table ${name} has no column ${column}`);

  return reservedTableNames.has(name)
    ? [`the table name ${name} is reserved for the host`, ...missing]
    : missing;
}

function collectFileProblems(consumers: readonly ListedConsumer[]): string[] {
  const tables = consumers.flatMap((consumer) => Object.keys(consumer.manifest.tables));

  return [
    ...collectRepeats(consumers.map((consumer) => consumer.name)).map(
      (name) => `the consumer ${name} is listed twice`,
    ),
    ...collectRepeats(tables).map((table) => `the table ${table} is in two consumers`),
  ];
}

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
  'scope_fact',
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
    for (const problem of collectManifestProblems(manifest)) {
      ctx.addIssue({ code: 'custom', ...problem });
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
// newer build fails at once.
export const consumerBuildManifestSchema = z
  .strictObject({
    kit: z.literal(1),
    deployment: nameSchema.nullable(),
    consumers: z.array(listedConsumerSchema),
  })
  .superRefine((file, ctx) => {
    for (const problem of collectFileProblems(file.consumers)) {
      ctx.addIssue({ code: 'custom', ...problem });
    }
  }) satisfies z.ZodType<ConsumerBuildManifest>;

// A problem sits at the field that breaks the rule, so a failure names the rule it came from.
interface Problem {
  readonly message: string;
  readonly path: (string | number)[];
}

interface Entry {
  readonly value: string;
  readonly path: (string | number)[];
}

function collectManifestProblems(manifest: ConsumerManifest): Problem[] {
  const symbols: Entry[] = [
    { value: manifest.exports.init, path: ['exports', 'init'] },
    { value: manifest.exports.apply, path: ['exports', 'apply'] },
    ...manifest.imports.flatMap((read, index) => [
      { value: read.length, path: ['imports', index, 'length'] },
      { value: read.into, path: ['imports', index, 'into'] },
    ]),
  ];

  return [
    ...collectReadProblems(manifest),
    ...collectRepeats(
      manifest.links.map((link, index) => ({ value: link.name, path: ['links', index] })),
    ).map((entry) => ({
      message: `the link type ${entry.value} is declared twice`,
      path: entry.path,
    })),
    ...collectRepeats(symbols).map((entry) => ({
      message: `the symbol ${entry.value} is used twice`,
      path: entry.path,
    })),
    ...Object.entries(manifest.tables).flatMap(([name, table]) =>
      collectTableProblems(name, table),
    ),
  ];
}

function collectReadProblems(manifest: ConsumerManifest): Problem[] {
  return match(manifest.input.mode)
    .with('scope', () => {
      const [read, ...others] = manifest.imports;

      return read?.kind === 'scope_facts' && others.length === 0
        ? []
        : [
            {
              message: 'a scope consumer has exactly one read, of kind scope_facts',
              path: ['imports'],
            },
          ];
    })
    .with('fact', () =>
      manifest.imports.flatMap((read, index): Problem[] =>
        match(read)
          .with({ kind: 'scope_facts' }, () => [
            { message: 'a fact consumer reads rows only', path: ['imports', index] },
          ])
          .with({ kind: 'row' }, (row) => {
            const table = Object.hasOwn(manifest.tables, row.table)
              ? manifest.tables[row.table]
              : undefined;

            return table === undefined
              ? [
                  {
                    message: `the row read names ${row.table}, which is no table of the consumer`,
                    path: ['imports', index, 'table'],
                  },
                ]
              : table.primaryKey.flatMap((column, keyIndex) =>
                  table.columns[column]?.kind === 'json'
                    ? [
                        {
                          message: `the row read of ${row.table} has the json key column ${column}`,
                          path: ['tables', row.table, 'primaryKey', keyIndex],
                        },
                      ]
                    : [],
                );
          })
          .exhaustive(),
      ),
    )
    .exhaustive();
}

// Reports the later entry of each value that appears more than once.
function collectRepeats(entries: readonly Entry[]): Entry[] {
  const seen = new Set<string>();
  const reported = new Set<string>();

  const repeats: Entry[] = [];

  for (const entry of entries) {
    if (seen.has(entry.value) && !reported.has(entry.value)) {
      reported.add(entry.value);
      repeats.push(entry);
    }

    seen.add(entry.value);
  }

  return repeats;
}

function collectTableProblems(name: string, table: ManifestTable): Problem[] {
  const keyColumns: Entry[] = table.primaryKey.map((column, index) => ({
    value: column,
    path: ['tables', name, 'primaryKey', index],
  }));

  const indexColumns: Entry[] = table.indexes.flatMap((index, indexPosition) =>
    index.map((column, columnPosition) => ({
      value: column,
      path: ['tables', name, 'indexes', indexPosition, columnPosition],
    })),
  );

  const missing = [...keyColumns, ...indexColumns]
    .filter((entry) => !Object.hasOwn(table.columns, entry.value))
    .map((entry) => ({
      message: `the table ${name} has no column ${entry.value}`,
      path: entry.path,
    }));

  const nullableKeys = keyColumns
    .filter((entry) => table.columns[entry.value]?.nullable === true)
    .map((entry) => ({
      message: `the key column ${entry.value} of the table ${name} is nullable`,
      path: entry.path,
    }));

  return reservedTableNames.has(name)
    ? [
        { message: `the table name ${name} is reserved for the host`, path: ['tables', name] },
        ...missing,
        ...nullableKeys,
      ]
    : [...missing, ...nullableKeys];
}

function collectFileProblems(consumers: readonly ListedConsumer[]): Problem[] {
  const tables = consumers.flatMap((consumer, index) =>
    Object.keys(consumer.manifest.tables).map((table) => ({
      value: table,
      path: ['consumers', index, 'manifest', 'tables', table],
    })),
  );

  return [
    ...collectRepeats(
      consumers.map((consumer, index) => ({ value: consumer.name, path: ['consumers', index] })),
    ).map((entry) => ({
      message: `the consumer ${entry.value} is listed twice`,
      path: entry.path,
    })),
    ...collectRepeats(tables).map((entry) => ({
      message: `the table ${entry.value} is in two consumers`,
      path: entry.path,
    })),
  ];
}

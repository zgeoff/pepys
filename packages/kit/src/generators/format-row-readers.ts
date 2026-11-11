import { match } from 'ts-pattern';
import type { ConsumerDeclaration } from '../consumers/types.ts';
import type { EntityKind } from '../link-types/types.ts';
import type { ColumnDeclaration } from '../types.ts';
import { collectViewKinds } from './collect-view-kinds.ts';
import { formatLiteral } from './format-literal.ts';
import { formatPropertyAccess } from './format-property-access.ts';
import { formatPropertyName } from './format-property-name.ts';
import { toEntityIDTypeName } from './to-entity-id-type-name.ts';
import { toPascalCase } from './to-pascal-case.ts';

// One reader per table in `reads`, through the two host functions of the table: the length of the
// row's JSON, or -1 for no row, and a copy of it into a buffer.
export function formatRowReaders(consumer: ConsumerDeclaration): string[] {
  if (consumer.reads.length === 0) {
    return [];
  }

  const viewKinds = collectViewKinds(consumer);

  return [
    ...consumer.reads.flatMap((tableName) => {
      const table = consumer.tables[tableName];

      return table === undefined
        ? []
        : [formatRowReader(tableName, Object.entries(table.columns), viewKinds)];
    }),
    [
      'function isEntityID(value: unknown): value is EntityID {',
      "  return typeof value === 'string';",
      '}',
    ].join('\n'),
  ];
}

function formatRowReader(
  tableName: string,
  columns: readonly (readonly [string, ColumnDeclaration])[],
  viewKinds: ReadonlyMap<string, EntityKind>,
): string {
  const name = toPascalCase(tableName);

  const checks = columns.flatMap(([columnName, column]) =>
    formatCheck(columnName, column, viewKinds.get(`${tableName}.${columnName}`)),
  );

  const fields = columns.map(
    ([columnName]) =>
      `    ${formatPropertyName(columnName)}: ${formatPropertyAccess('parsed', columnName)},`,
  );

  return [
    `declare function read${name}Length(key: string): number;`,
    `declare function read${name}Into(key: string, row: Uint8Array): void;`,
    '',
    `export function read${name}Row(key: string): ${name}Row | undefined {`,
    `  const length = read${name}Length(key);`,
    '',
    '  if (length < 0) {',
    '    return undefined;',
    '  }',
    '',
    '  const row = new Uint8Array(length);',
    '',
    `  read${name}Into(key, row);`,
    '',
    '  const parsed: unknown = JSON.parse(new TextDecoder().decode(row));',
    '',
    "  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {",
    '    return undefined;',
    '  }',
    '',
    ...checks,
    '  return {',
    ...fields,
    '  };',
    '}',
  ].join('\n');
}

function formatCheck(
  columnName: string,
  column: ColumnDeclaration,
  kind: EntityKind | undefined,
): string[] {
  const value = formatPropertyAccess('parsed', columnName);
  const mismatch = formatMismatch(value, column, kind);
  const conditions = [`!(${formatLiteral(columnName)} in parsed)`, ...mismatch];

  return [`  if (${conditions.join(' || ')}) {`, '    return undefined;', '  }', ''];
}

function formatMismatch(
  value: string,
  column: ColumnDeclaration,
  kind: EntityKind | undefined,
): string[] {
  const mismatch = match(column.kind)
    .with('text', 'timestamp', () => `typeof ${value} !== 'string'`)
    .with('integer', 'real', () => `typeof ${value} !== 'number'`)
    .with('boolean', () => `typeof ${value} !== 'boolean'`)
    .with('entityID', () =>
      kind === undefined
        ? `!isEntityID(${value})`
        : `typeof ${value} !== 'string' || !is${toEntityIDTypeName(kind)}(${value})`,
    )
    .with('json', () => null)
    .exhaustive();

  if (mismatch === null) {
    return [];
  }

  return [column.nullable === true ? `(${value} !== null && (${mismatch}))` : `(${mismatch})`];
}

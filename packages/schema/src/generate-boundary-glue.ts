import { match } from 'ts-pattern';
import { findTable } from './find-table.ts';
import { formatTypeScriptRow } from './format-typescript-row.ts';
import { toPascalCase } from './to-pascal-case.ts';
import { toTypeScriptType } from './to-typescript-type.ts';
import type { ColumnDeclaration, ConsumerDeclaration, TableDeclaration } from './types.ts';

type NamedTable = readonly [name: string, table: TableDeclaration];

interface BoundaryGlueParameters {
  consumer: ConsumerDeclaration;
  consumers: readonly ConsumerDeclaration[];
}

export function generateBoundaryGlue(parameters: BoundaryGlueParameters): string {
  const consumer = parameters.consumer;
  const consumers = parameters.consumers;
  const ownTables = Object.entries(consumer.tables);

  const readTables = consumer.reads.flatMap((name): NamedTable[] => {
    const table = findTable(consumers, name);

    return table === undefined ? [] : [[name, table]];
  });

  const foreignTables = readTables.filter(([name]) => !(name in consumer.tables));
  const rowTables = [...ownTables, ...foreignTables];

  const sections = [
    ...(hasEntityID(rowTables) ? [formatBrand()] : []),
    ...rowTables.map(([name, table]) => formatTypeScriptRow(name, table, 'EntityID')),
    ...ownTables.map(([name, table]) => formatKey(name, table)),
    formatOperation(consumer.name, ownTables),
    ...readTables.map(([name]) => formatDeclarations(name)),
    ...readTables.map(([name, table]) => formatGetter(name, table)),
    ...(hasEntityID(readTables) ? [formatEntityIDGuard()] : []),
  ];

  return `${sections.join('\n\n')}\n`;
}

function hasEntityID(tables: readonly NamedTable[]): boolean {
  return tables.some(([, table]) =>
    Object.values(table.columns).some((column) => column.kind === 'entityID'),
  );
}

function formatBrand(): string {
  return [
    'declare const idTag: unique symbol;',
    '',
    "export type EntityID = string & { readonly [idTag]: 'EntityID' };",
  ].join('\n');
}

function formatKey(tableName: string, table: TableDeclaration): string {
  const fields = table.primaryKey.flatMap((columnName) => {
    const column = table.columns[columnName];

    return column === undefined
      ? []
      : [`  ${columnName}: ${toTypeScriptType(column, 'EntityID')};`];
  });

  return [`export interface ${toPascalCase(tableName)}Key {`, ...fields, '}'].join('\n');
}

function formatOperation(consumerName: string, tables: readonly NamedTable[]): string {
  const members = tables.flatMap(([name]) => [
    `  | { upsert: { ${name}: ${toPascalCase(name)}Row } }`,
    `  | { delete: { ${name}: ${toPascalCase(name)}Key } }`,
  ]);

  return `${[`export type ${toPascalCase(consumerName)}Operation =`, ...members].join('\n')};`;
}

function formatDeclarations(tableName: string): string {
  const name = toPascalCase(tableName);

  return [
    `declare function read${name}Length(key: string): number;`,
    `declare function read${name}Into(key: string, row: Uint8Array): void;`,
  ].join('\n');
}

function formatGetter(tableName: string, table: TableDeclaration): string {
  const name = toPascalCase(tableName);
  const columns = Object.entries(table.columns);
  const checks = columns.flatMap(([columnName, column]) => formatCheck(columnName, column));
  const fields = columns.map(([columnName]) => `    ${columnName}: parsed.${columnName},`);

  return [
    `export function get${name}(key: string): ${name}Row | undefined {`,
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

function formatCheck(columnName: string, column: ColumnDeclaration): string[] {
  const value = `parsed.${columnName}`;
  const mismatch = formatMismatch(value, column);
  const conditions = [`!('${columnName}' in parsed)`, ...mismatch];

  return [`  if (${conditions.join(' || ')}) {`, '    return undefined;', '  }', ''];
}

function formatMismatch(value: string, column: ColumnDeclaration): string[] {
  const mismatch = match(column.kind)
    .with('text', 'timestamp', () => `typeof ${value} !== 'string'`)
    .with('integer', 'real', () => `typeof ${value} !== 'number'`)
    .with('boolean', () => `typeof ${value} !== 'boolean'`)
    .with('entityID', () => `!isEntityID(${value})`)
    .with('json', () => null)
    .exhaustive();

  if (mismatch === null) {
    return [];
  }

  return [column.nullable === true ? `(${value} !== null && ${mismatch})` : mismatch];
}

function formatEntityIDGuard(): string {
  return [
    'function isEntityID(value: unknown): value is EntityID {',
    "  return typeof value === 'string';",
    '}',
  ].join('\n');
}

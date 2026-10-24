import { match } from 'ts-pattern';
import { toPascalCase } from './to-pascal-case.ts';
import { toSnakeCase } from './to-snake-case.ts';
import type { ColumnDeclaration, ConsumerDeclaration, TableDeclaration } from './types.ts';

export function generateRustTypes(consumers: readonly ConsumerDeclaration[]): string {
  const items = [
    [
      '#[derive(Debug, Clone, Copy, PartialEq, Eq)]',
      'pub struct ReadImport {',
      "    pub table: &'static str,",
      "    pub length: &'static str,",
      "    pub into: &'static str,",
      '}',
    ].join('\n'),
    [
      '#[derive(Debug, Clone, Copy, PartialEq, Eq)]',
      'pub enum ColumnKind {',
      '    Text,',
      '    Integer,',
      '    Real,',
      '    Boolean,',
      '    Json,',
      '    EntityId,',
      '    Timestamp,',
      '}',
    ].join('\n'),
    [
      '#[derive(Debug, Clone, Copy, PartialEq, Eq)]',
      'pub struct ColumnInfo {',
      "    pub name: &'static str,",
      '    pub kind: ColumnKind,',
      '    pub nullable: bool,',
      '}',
    ].join('\n'),
    [
      '#[derive(Debug, Clone, Copy, PartialEq, Eq)]',
      'pub struct TableInfo {',
      "    pub name: &'static str,",
      "    pub columns: &'static [ColumnInfo],",
      "    pub primary_key: &'static [&'static str],",
      '}',
    ].join('\n'),
    ...consumers.flatMap((consumer) => formatConsumer(consumer)),
  ];

  return `${items.join('\n\n')}\n`;
}

const derives = '#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]';

function formatConsumer(consumer: ConsumerDeclaration): string[] {
  const tables = Object.entries(consumer.tables);
  const consumerName = toPascalCase(consumer.name);

  return [
    ...tables.flatMap(([name, table]) => [
      formatStruct(`${toPascalCase(name)}Row`, table, Object.keys(table.columns)),
      formatStruct(`${toPascalCase(name)}Key`, table, table.primaryKey),
    ]),
    formatTableEnum(`${consumerName}Upsert`, tables, 'Row'),
    formatTableEnum(`${consumerName}Delete`, tables, 'Key'),
    [
      derives,
      '#[serde(rename_all = "snake_case")]',
      `pub enum ${consumerName}Operation {`,
      `    Upsert(Box<${consumerName}Upsert>),`,
      `    Delete(${consumerName}Delete),`,
      '}',
    ].join('\n'),
    formatTables(consumer),
    formatReads(consumer),
  ];
}

function formatStruct(
  structName: string,
  table: TableDeclaration,
  columnNames: readonly string[],
): string {
  const fields = columnNames.flatMap((columnName) => {
    const column = table.columns[columnName];

    return column === undefined ? [] : formatField(columnName, column);
  });

  return [derives, `pub struct ${structName} {`, ...fields, '}'].join('\n');
}

function formatField(columnName: string, column: ColumnDeclaration): string[] {
  const snakeName = toSnakeCase(columnName);
  const identifier = toRustIdentifier(snakeName);
  const rename = identifier.replace(/^r#/u, '') === columnName ? [] : [columnName];
  const type = toRustType(column);

  return [
    ...rename.map((sqlName) => `    #[serde(rename = "${sqlName}")]`),
    `    pub ${identifier}: ${type},`,
  ];
}

const rawIdentifiers = new Set([
  'abstract',
  'as',
  'async',
  'await',
  'become',
  'box',
  'break',
  'const',
  'continue',
  'do',
  'dyn',
  'else',
  'enum',
  'extern',
  'false',
  'final',
  'fn',
  'for',
  'gen',
  'if',
  'impl',
  'in',
  'let',
  'loop',
  'macro',
  'match',
  'mod',
  'move',
  'mut',
  'override',
  'priv',
  'pub',
  'ref',
  'return',
  'static',
  'struct',
  'trait',
  'true',
  'try',
  'type',
  'typeof',
  'unsafe',
  'unsized',
  'use',
  'virtual',
  'where',
  'while',
  'yield',
]);

const unescapableIdentifiers = new Set(['crate', 'self', 'Self', 'super']);

function toRustIdentifier(name: string): string {
  if (unescapableIdentifiers.has(name)) {
    return `${name}_`;
  }

  return rawIdentifiers.has(name) ? `r#${name}` : name;
}

function toRustType(column: ColumnDeclaration): string {
  const type = match(column.kind)
    .with('text', 'entityID', 'timestamp', () => 'String')
    .with('integer', () => 'i64')
    .with('real', () => 'f64')
    .with('boolean', () => 'bool')
    .with('json', () => 'serde_json::Value')
    .exhaustive();

  return column.nullable === true ? `Option<${type}>` : type;
}

function formatTableEnum(
  enumName: string,
  tables: readonly (readonly [string, TableDeclaration])[],
  payloadSuffix: 'Row' | 'Key',
): string {
  const variants = tables.flatMap(([name]) => [
    `    #[serde(rename = "${name}")]`,
    `    ${toPascalCase(name)}(${toPascalCase(name)}${payloadSuffix}),`,
  ]);

  return [derives, `pub enum ${enumName} {`, ...variants, '}'].join('\n');
}

function formatTables(consumer: ConsumerDeclaration): string {
  const tables = Object.entries(consumer.tables);
  const constantName = `${toSnakeCase(consumer.name).toUpperCase()}_TABLES`;

  const entries = tables.flatMap(([name, table]) => [
    'TableInfo {',
    `    name: "${name}",`,
    '    columns: &[',
    ...Object.entries(table.columns).flatMap(([columnName, column]) =>
      formatColumnInfo(columnName, column).map((line) => `        ${line}`),
    ),
    '    ],',
    `    primary_key: &[${table.primaryKey.map((columnName) => `"${columnName}"`).join(', ')}],`,
    '},',
  ]);

  // rustfmt hugs the brackets around a lone element and puts each of several on its own lines.
  if (tables.length === 1) {
    return [
      `pub const ${constantName}: [TableInfo; 1] = [${entries[0]}`,
      ...entries.slice(1, -1),
      '}];',
    ].join('\n');
  }

  return [
    `pub const ${constantName}: [TableInfo; ${tables.length}] = [`,
    ...entries.map((line) => `    ${line}`),
    '];',
  ].join('\n');
}

function formatColumnInfo(columnName: string, column: ColumnDeclaration): string[] {
  const kind = match(column.kind)
    .with('text', () => 'Text')
    .with('integer', () => 'Integer')
    .with('real', () => 'Real')
    .with('boolean', () => 'Boolean')
    .with('json', () => 'Json')
    .with('entityID', () => 'EntityId')
    .with('timestamp', () => 'Timestamp')
    .exhaustive();

  return [
    'ColumnInfo {',
    `    name: "${columnName}",`,
    `    kind: ColumnKind::${kind},`,
    `    nullable: ${column.nullable === true ? 'true' : 'false'},`,
    '},',
  ];
}

function formatReads(consumer: ConsumerDeclaration): string {
  const constantName = `${toSnakeCase(consumer.name).toUpperCase()}_READS`;
  const declaration = `pub const ${constantName}: [ReadImport; ${consumer.reads.length}] =`;

  if (consumer.reads.length === 0) {
    return `${declaration} [];`;
  }

  const imports = consumer.reads.map((table) =>
    [
      'ReadImport {',
      `    table: "${table}",`,
      `    length: "read${toPascalCase(table)}Length",`,
      `    into: "read${toPascalCase(table)}Into",`,
      '}',
    ].join('\n'),
  );

  // rustfmt hugs the brackets around a lone element and puts each of several on its own lines.
  if (imports.length === 1) {
    return `${declaration} [${imports.join('')}];`;
  }

  const lines = imports
    .map((entry) => `${entry},`)
    .join('\n')
    .split('\n');

  return [`${declaration} [`, ...lines.map((line) => `    ${line}`), '];'].join('\n');
}

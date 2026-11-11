import type { ConsumerDeclaration } from '../consumers/types.ts';
import type { EntityKind, LinkTypeDeclaration } from '../link-types/types.ts';
import type { ColumnDeclaration, TableDeclaration } from '../types.ts';
import { collectViewKinds } from './collect-view-kinds.ts';
import { formatColumnType } from './format-column-type.ts';
import { formatLiteral } from './format-literal.ts';
import { formatPropertyName } from './format-property-name.ts';
import { toEntityIDTypeName } from './to-entity-id-type-name.ts';
import { toPascalCase } from './to-pascal-case.ts';

// The row and key type of each table, the link of each link type, the operation union, and one
// constructor per link type. A delete and an unlink are fact mode only.
export function formatOperations(consumer: ConsumerDeclaration): string[] {
  const consumerName = toPascalCase(consumer.name);
  const isFactMode = consumer.input.mode === 'fact';
  const tables = Object.entries(consumer.tables);
  const columnKinds = collectViewKinds(consumer);

  return [
    ...tables.map(([name, table]) =>
      formatRecord(`${toPascalCase(name)}Row`, Object.entries(table.columns), columnKinds, name),
    ),
    ...(isFactMode
      ? tables.map(([name, table]) =>
          formatRecord(`${toPascalCase(name)}Key`, collectKey(table), columnKinds, name),
        )
      : []),
    formatOperationUnion(consumerName, consumer, isFactMode),
    ...consumer.links.map((link) => formatLinkConstructor(consumerName, link)),
    ...(isFactMode
      ? consumer.links.map((link) => formatUnlinkConstructor(consumerName, link))
      : []),
  ];
}

function formatRecord(
  typeName: string,
  columns: readonly (readonly [string, ColumnDeclaration])[],
  columnKinds: ReadonlyMap<string, EntityKind>,
  tableName: string,
): string {
  const fields = columns.map(
    ([name, column]) =>
      `  ${formatPropertyName(name)}: ${formatColumnType(column, columnKinds.get(`${tableName}.${name}`))};`,
  );

  return [`export interface ${typeName} {`, ...fields, '}'].join('\n');
}

function collectKey(table: TableDeclaration): [string, ColumnDeclaration][] {
  return table.primaryKey.flatMap((name) => {
    const column = table.columns[name];

    return column === undefined ? [] : [[name, column]];
  });
}

function formatOperationUnion(
  consumerName: string,
  consumer: ConsumerDeclaration,
  isFactMode: boolean,
): string {
  const tableMembers = Object.keys(consumer.tables).flatMap((name) => {
    const key = formatPropertyName(name);
    const upsert = `  | { upsert: { ${key}: ${toPascalCase(name)}Row } }`;

    return isFactMode ? [upsert, `  | { delete: { ${key}: ${toPascalCase(name)}Key } }`] : [upsert];
  });

  const linkMembers = consumer.links.flatMap((link) => {
    const type = formatLiteral(link.name);
    const ends = `from: ${formatEndType(link.from)}; to: ${formatEndType(link.to)}`;
    const linkMember = `  | { link: { type: ${type}; ${ends}; confidence: number; evidence: string } }`;

    return isFactMode ? [linkMember, `  | { unlink: { type: ${type}; ${ends} } }`] : [linkMember];
  });

  const members = [...tableMembers, ...linkMembers];

  if (members.length === 0) {
    return `export type ${consumerName}Operation = never;`;
  }

  return `${[`export type ${consumerName}Operation =`, ...members].join('\n')};`;
}

function formatEndType(kinds: readonly EntityKind[]): string {
  return kinds.map((kind) => toEntityIDTypeName(kind)).join(' | ');
}

function formatLinkConstructor(consumerName: string, link: LinkTypeDeclaration): string {
  const ends = `from: ${formatEndType(link.from)}; to: ${formatEndType(link.to)}`;

  return [
    `export function link${toPascalCase(link.name)}(link: { ${ends}; confidence: number; evidence: string }): ${consumerName}Operation {`,
    `  return { link: { type: ${formatLiteral(link.name)}, from: link.from, to: link.to, confidence: link.confidence, evidence: link.evidence } };`,
    '}',
  ].join('\n');
}

function formatUnlinkConstructor(consumerName: string, link: LinkTypeDeclaration): string {
  const ends = `from: ${formatEndType(link.from)}; to: ${formatEndType(link.to)}`;

  return [
    `export function unlink${toPascalCase(link.name)}(link: { ${ends} }): ${consumerName}Operation {`,
    `  return { unlink: { type: ${formatLiteral(link.name)}, from: link.from, to: link.to } };`,
    '}',
  ].join('\n');
}

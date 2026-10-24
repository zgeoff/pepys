import { match } from 'ts-pattern';
import { quoteSqlIdentifier } from './quote-sql-identifier.ts';
import type { ColumnDeclaration, ConsumerDeclaration, EntityViewDeclaration } from './types.ts';

export function generateSqliteSchema(consumer: ConsumerDeclaration): string {
  const statements: string[] = [];

  for (const [name, table] of Object.entries(consumer.tables)) {
    statements.push(formatCreateTable(name, table.columns, table.primaryKey));

    for (const index of table.indexes) {
      const indexName = quoteSqlIdentifier(`${name}_${index.columns.join('_')}_idx`);
      const columns = index.columns.map((column) => quoteSqlIdentifier(column)).join(', ');

      statements.push(`CREATE INDEX ${indexName} ON ${quoteSqlIdentifier(name)} (${columns});`);
    }
  }

  if (consumer.entityView !== undefined) {
    statements.push(formatEntityView(consumer.entityView));
  }

  return `${statements.join('\n\n')}\n`;
}

function formatCreateTable(
  name: string,
  columns: Readonly<Record<string, ColumnDeclaration>>,
  primaryKey: readonly string[],
): string {
  const definitions = Object.entries(columns).map(
    ([columnName, column]) =>
      `  ${quoteSqlIdentifier(columnName)} ${toSqliteType(column)}${column.nullable === true ? '' : ' NOT NULL'}`,
  );

  return [
    `CREATE TABLE ${quoteSqlIdentifier(name)} (`,
    [
      ...definitions,
      `  PRIMARY KEY (${primaryKey.map((column) => quoteSqlIdentifier(column)).join(', ')})`,
    ].join(',\n'),
    ');',
  ].join('\n');
}

function toSqliteType(column: ColumnDeclaration): string {
  return match(column.kind)
    .with('text', 'json', 'entityID', 'timestamp', () => 'TEXT')
    .with('integer', 'boolean', () => 'INTEGER')
    .with('real', () => 'REAL')
    .exhaustive();
}

function formatEntityView(view: EntityViewDeclaration): string {
  const kind = `'${view.kind.replaceAll("'", "''")}'`;

  const selections = [
    `${quoteSqlIdentifier(view.id)} AS "id"`,
    `${kind} AS "kind"`,
    `${quoteSqlIdentifier(view.title)} AS "title"`,
    `${quoteSqlIdentifier(view.url)} AS "url"`,
    `${quoteSqlIdentifier(view.actor)} AS "actor"`,
    `${quoteSqlIdentifier(view.updatedAt)} AS "updated_at"`,
  ].map((selection) => `  ${selection}`);

  return [
    'CREATE VIEW "entity" AS',
    'SELECT',
    selections.join(',\n'),
    `FROM ${quoteSqlIdentifier(view.table)};`,
  ].join('\n');
}

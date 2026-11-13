import { match } from 'ts-pattern';
import type { ConsumerDeclaration, EntityViewDeclaration } from '../consumers/types.ts';
import type { ColumnDeclaration } from '../types.ts';
import { formatSQLIdentifier } from './format-sql-identifier.ts';

export function generateSqliteSchema(consumer: ConsumerDeclaration): string {
  const statements: string[] = [];

  for (const [name, table] of Object.entries(consumer.tables)) {
    statements.push(formatCreateTable(name, table.columns, table.primaryKey));

    for (const index of table.indexes) {
      const indexName = formatSQLIdentifier(`${name}_${index.columns.join('_')}_idx`);
      const columns = index.columns.map((column) => formatSQLIdentifier(column)).join(', ');

      statements.push(`CREATE INDEX ${indexName} ON ${formatSQLIdentifier(name)} (${columns});`);
    }
  }

  if (consumer.entityViews.length > 0) {
    statements.push(formatEntityView(consumer.entityViews));
  }

  return `${statements.join('\n\n')}\n`;
}

function formatCreateTable(
  name: string,
  columns: Readonly<Record<string, ColumnDeclaration>>,
  primaryKey: readonly string[],
): string {
  const definitions = Object.entries(columns).map(([columnName, column]) => {
    const isNotNull = column.nullable !== true || primaryKey.includes(columnName);

    return `  ${formatSQLIdentifier(columnName)} ${toSqliteType(column)}${isNotNull ? ' NOT NULL' : ''}`;
  });

  return [
    `CREATE TABLE ${formatSQLIdentifier(name)} (`,
    [
      ...definitions,
      `  PRIMARY KEY (${primaryKey.map((column) => formatSQLIdentifier(column)).join(', ')})`,
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

function formatEntityView(views: readonly EntityViewDeclaration[]): string {
  const selects = views.map((view) => formatEntitySelect(view)).join('\nUNION ALL\n');

  return `CREATE VIEW "entity" AS\n${selects};`;
}

function formatEntitySelect(view: EntityViewDeclaration): string {
  const kind = `'${view.kind.replaceAll("'", "''")}'`;

  const selections = [
    `${formatSQLIdentifier(view.id)} AS "id"`,
    `${kind} AS "kind"`,
    `${formatSQLIdentifier(view.title)} AS "title"`,
    `${formatOptionalColumn(view.url)} AS "url"`,
    `${formatOptionalColumn(view.actor)} AS "actor"`,
    `${formatSQLIdentifier(view.updatedAt)} AS "updated_at"`,
  ].map((selection) => `  ${selection}`);

  const from = `FROM ${formatSQLIdentifier(view.table)}`;

  const where =
    view.deletedAt === undefined ? [] : [`WHERE ${formatSQLIdentifier(view.deletedAt)} IS NULL`];

  return ['SELECT', selections.join(',\n'), from, ...where].join('\n');
}

function formatOptionalColumn(column: string | null): string {
  return column === null ? 'NULL' : formatSQLIdentifier(column);
}

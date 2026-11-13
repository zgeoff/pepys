import invariant from 'tiny-invariant';

// A column as `PRAGMA table_info` gives it, with whether a unique constraint
// covers it alone.
export interface TableColumn {
  readonly name: string;
  readonly type: string;
  readonly notnull: number;
  readonly dflt_value: string | null;
  readonly pk: number;
  readonly isUnique: boolean;
}

// A foreign key as `PRAGMA foreign_key_list` gives it.
export interface TableForeignKey {
  readonly from: string;
  readonly table: string;
  readonly to: string;
  readonly on_delete: string;
}

// The `create table` statement of a table with these columns and keys, so a
// table rebuilt from its pragmas keeps every column whatever schema made it.
export function buildTableSQL(
  name: string,
  columns: readonly TableColumn[],
  foreignKeys: readonly TableForeignKey[],
): string {
  invariant(
    columns.filter((column) => column.pk > 0).length <= 1,
    'a table the auth core uses has a one-column primary key',
  );

  const definitions = columns.map((column) => {
    const key = foreignKeys.find((foreign) => foreign.from === column.name);

    return [
      quoteName(column.name),
      column.type.toLowerCase(),
      ...(column.notnull === 1 ? ['not null'] : []),
      ...(column.pk > 0 ? ['primary key'] : []),
      ...(column.isUnique ? ['unique'] : []),
      ...(column.dflt_value === null ? [] : [`default ${column.dflt_value}`]),
      ...(key === undefined
        ? []
        : [
            `references ${quoteName(key.table)} (${quoteName(key.to)}) on delete ${key.on_delete.toLowerCase()}`,
          ]),
    ].join(' ');
  });

  return `create table ${quoteName(name)} (${definitions.join(', ')})`;
}

function quoteName(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

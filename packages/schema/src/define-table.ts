import type { ColumnDeclaration, IndexDeclaration, TableDeclaration } from './types.ts';

interface TableInput<Columns extends Readonly<Record<string, ColumnDeclaration>>> {
  readonly columns: Columns;
  readonly primaryKey: readonly NoInfer<keyof Columns & string>[];
  readonly indexes: readonly IndexDeclaration<NoInfer<keyof Columns & string>>[];
}

export function defineTable<const Columns extends Readonly<Record<string, ColumnDeclaration>>>(
  table: TableInput<Columns>,
): TableDeclaration<Columns> {
  return table;
}

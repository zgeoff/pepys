import type { ColumnDeclaration, EntityID, TableDeclaration } from './types.ts';

interface KindTypes {
  text: string;
  integer: number;
  real: number;
  boolean: boolean;
  json: unknown;
  entityID: EntityID;
  timestamp: string;
}

type ColumnValue<Column extends ColumnDeclaration> = Column['nullable'] extends true
  ? KindTypes[Column['kind']] | null
  : KindTypes[Column['kind']];

export type TableRow<Table extends TableDeclaration> = {
  -readonly [Name in keyof Table['columns']]: ColumnValue<Table['columns'][Name]>;
};

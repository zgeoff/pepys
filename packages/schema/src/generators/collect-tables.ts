import type { ConsumerDeclaration, TableDeclaration } from '@pepys/kit';

export interface TableEntry {
  consumer: string;
  name: string;
  table: TableDeclaration;
}

export function collectTables(consumers: readonly ConsumerDeclaration[]): TableEntry[] {
  return consumers.flatMap((consumer) =>
    Object.entries(consumer.tables).map(([name, table]) => ({
      consumer: consumer.name,
      name,
      table,
    })),
  );
}

import type { ConsumerDeclaration, TableDeclaration } from './types.ts';

export function findTable(
  consumers: readonly ConsumerDeclaration[],
  name: string,
): TableDeclaration | undefined {
  return consumers.map((consumer) => consumer.tables[name]).find((table) => table !== undefined);
}

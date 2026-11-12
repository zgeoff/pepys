export function buildRowID(table: string, key: string): string {
  return JSON.stringify([table, key]);
}

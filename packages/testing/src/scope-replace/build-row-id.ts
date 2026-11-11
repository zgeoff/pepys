// One text for a table and a row key, for a map that holds the rows of several tables.
export function buildRowID(table: string, key: string): string {
  return JSON.stringify([table, key]);
}

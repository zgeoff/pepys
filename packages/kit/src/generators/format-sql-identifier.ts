export function formatSQLIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

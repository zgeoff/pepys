export function quoteSqlIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

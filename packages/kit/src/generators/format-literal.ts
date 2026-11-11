// A TypeScript literal in single quotes, the quote style of the rest of the glue.
export function formatLiteral(value: string | number | boolean): string {
  if (typeof value !== 'string') {
    return String(value);
  }

  const escaped = JSON.stringify(value)
    .slice(1, -1)
    .replaceAll(String.raw`\"`, '"')
    .replaceAll("'", String.raw`\'`);

  return `'${escaped}'`;
}

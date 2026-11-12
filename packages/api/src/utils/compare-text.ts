// UTF-16 code unit order, as the default sort gives, never the locale's. SQLite's binary collation
// orders by code point instead, so text above U+FFFF can sort apart from a SQL `ORDER BY`.
export function compareText(first: string, second: string): number {
  if (first === second) {
    return 0;
  }

  return first < second ? -1 : 1;
}

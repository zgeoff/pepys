// UTF-16 code unit order, never the locale's: an answer needs one stable order, not SQLite's code
// point order, so text above U+FFFF may sort apart from a SQL `ORDER BY`.
export function compareText(first: string, second: string): number {
  if (first === second) {
    return 0;
  }

  return first < second ? -1 : 1;
}

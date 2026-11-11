// Code unit order, as the default sort and SQLite's binary collation give, not the locale's.
export function compareText(first: string, second: string): number {
  if (first === second) {
    return 0;
  }

  return first < second ? -1 : 1;
}

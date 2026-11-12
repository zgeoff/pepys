// The host's Rust strings and SQLite's binary collation order text by code point, but `<` on
// JavaScript strings compares UTF-16 code units, which puts text above U+FFFF before U+E000.
export function compareCodePoints(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  let index = 0;

  while (index < length) {
    const leftPoint = left.codePointAt(index) ?? 0;
    const rightPoint = right.codePointAt(index) ?? 0;

    if (leftPoint !== rightPoint) {
      return leftPoint - rightPoint;
    }

    index += leftPoint > 0xff_ff ? 2 : 1;
  }

  return left.length - right.length;
}

import { expect, test } from 'bun:test';
import { compareCodePoints } from './compare-code-points.ts';

test.each([
  ['a key above U+FFFF after a key at U+E000', ['\u{10000}', ''], ['', '\u{10000}']],
  ['a key at U+FFFF before a key above it', ['\u{1F6A2}', '￿'], ['￿', '\u{1F6A2}']],
  ['a key below U+D800 before a key above U+FFFF', ['\u{10000}', 'z'], ['z', '\u{10000}']],
  [
    'two keys above U+FFFF in code point order',
    ['\u{1F6A2}', '\u{10000}'],
    ['\u{10000}', '\u{1F6A2}'],
  ],
  ['a prefix before the longer key', ['harbour', 'harb'], ['harb', 'harbour']],
  ['equal keys together', ['tern', 'gull', 'tern'], ['gull', 'tern', 'tern']],
])('#compareCodePoints sorts %s', (_title, keys, sorted) => {
  expect(keys.toSorted(compareCodePoints)).toStrictEqual(sorted);
});

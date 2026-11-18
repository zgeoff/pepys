import { expect, test } from 'bun:test';
import { isNestedTooDeep } from './is-nested-too-deep.ts';

test.each<{ text: string; expected: boolean }>([
  { text: 'null', expected: false },
  { text: '"tide"', expected: false },
  { text: '[]', expected: false },
  { text: '{"wide":[1,2,3],"flat":{"a":{"b":[]}}}', expected: false },
  { text: `${'['.repeat(64)}0${']'.repeat(64)}`, expected: false },
  { text: `${'['.repeat(65)}${']'.repeat(65)}`, expected: true },
  { text: `${'['.repeat(65)}0${']'.repeat(65)}`, expected: true },
  { text: `${'{"a":'.repeat(64)}0${'}'.repeat(64)}`, expected: false },
  { text: `${'{"a":'.repeat(65)}0${'}'.repeat(65)}`, expected: true },
  { text: `[0,{"a":1},${'[{"a":'.repeat(33)}0${'}]'.repeat(33)}]`, expected: true },
  { text: `[0,{"a":1},${'[{"a":'.repeat(31)}0${'}]'.repeat(31)}]`, expected: false },
])('it returns $expected for the JSON value $text', (row) => {
  const value: unknown = JSON.parse(row.text);

  expect(isNestedTooDeep(value)).toBe(row.expected);
});

test('it returns true for 200000 nested arrays, with no stack overflow', () => {
  let value: unknown = 0;

  for (let level = 0; level < 200_000; level += 1) {
    value = [value];
  }

  expect(isNestedTooDeep(value)).toBe(true);
});

import { expect, test } from 'bun:test';
import { isEntityID } from './is-entity-id.ts';

test.each([
  { text: 'harbour:vessel:7', expected: true },
  { text: 'harbour:vessel:a:b', expected: true },
  { text: 'vessel-7', expected: false },
  { text: 'harbour:vessel:', expected: false },
  { text: 'Harbour:vessel:7', expected: false },
])('it answers $expected for $text', (row) => {
  expect(isEntityID(row.text)).toBe(row.expected);
});

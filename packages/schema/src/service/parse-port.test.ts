import { expect, test } from 'bun:test';
import { parsePort } from './parse-port.ts';

test.each([
  ['1', 1],
  ['8081', 8081],
  ['65535', 65_535],
  ['08081', 8081],
])('it parses %s as port %d', (text, port) => {
  expect(parsePort(text)).toStrictEqual({ ok: true, value: port });
});

test.each([
  ['an empty value', ''],
  ['port zero', '0'],
  ['a port above 65535', '65536'],
  ['a negative number', '-1'],
  ['exponent notation', '1e3'],
  ['a hexadecimal number', '0x50'],
  ['a decimal fraction', '80.5'],
  ['a padded number', ' 80'],
  ['a word', 'eighty'],
])('it refuses %s', (_label, text) => {
  expect(parsePort(text)).toStrictEqual({ ok: false, failure: { reason: 'not-a-port' } });
});

import { expect, test } from 'bun:test';
import { createStubHostRead } from './create-stub-host-read.ts';

test('it puts the two host functions of the read on globalThis under their import names', () => {
  const hostRead = createStubHostRead('TideReading', new Map());

  expect({
    readLength: Reflect.get(globalThis, 'readTideReadingLength'),
    readInto: Reflect.get(globalThis, 'readTideReadingInto'),
  }).toStrictEqual({ readLength: hostRead.readLength, readInto: hostRead.readInto });
});

test('it answers the length of a row in UTF-8 bytes', () => {
  const hostRead = createStubHostRead(
    'TideReading',
    new Map([['tide:reading:1', '{"note":"höhe"}']]),
  );

  expect(hostRead.readLength('tide:reading:1')).toBe(16);
});

test('it answers -1 for the length of a key with no row', () => {
  const hostRead = createStubHostRead('TideReading', new Map());

  expect(hostRead.readLength('tide:reading:1')).toBe(-1);
});

test('it writes the bytes of a row into the buffer', () => {
  const hostRead = createStubHostRead(
    'TideReading',
    new Map([['tide:reading:1', '{"note":"höhe"}']]),
  );

  const buffer = new Uint8Array(16);

  hostRead.readInto('tide:reading:1', buffer);

  expect(new TextDecoder().decode(buffer)).toBe('{"note":"höhe"}');
});

test('it answers a row that the test adds after it creates the read', () => {
  const rows = new Map<string, string>();

  const hostRead = createStubHostRead('TideReading', rows);

  rows.set('tide:reading:2', '{}');

  expect(hostRead.readLength('tide:reading:2')).toBe(2);
});

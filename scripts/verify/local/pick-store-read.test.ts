import { expect, test } from 'bun:test';
import { pickStoreRead } from './pick-store-read.ts';

test("it reads the consumer folder with sqlite3's flags", () => {
  const read = pickStoreRead(['-safe', '-json', '-readonly', '/srv/store/harbour_voyage']);

  expect(read).toStrictEqual({
    kind: 'read',
    flags: ['-safe', '-json', '-readonly'],
    consumerDirectory: '/srv/store/harbour_voyage',
  });
});

test('it refuses a write, which a copy of the file cannot keep', () => {
  const read = pickStoreRead(['-safe', '-json', '/srv/store/harbour_voyage']);

  expect(read).toMatchObject({ kind: 'refused' });
});

test.each([[[]], [['-safe', '-json', '-readonly']]])(
  'it refuses %p, which names no folder',
  (argv) => {
    expect(pickStoreRead(argv)).toMatchObject({ kind: 'refused' });
  },
);

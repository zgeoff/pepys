import { expect, test } from 'bun:test';
import { collectLaggingConsumers } from './collect-lagging-consumers.ts';

test('it collects a consumer with no current version and one whose current version is older', () => {
  const lagging = collectLaggingConsumers(
    [
      { name: 'shelf_book', version: 'a1' },
      { name: 'shelf_loan', version: 'b2' },
      { name: 'shelf_author', version: 'c3' },
    ],
    new Map([
      ['shelf_book', 'a1'],
      ['shelf_loan', null],
      ['shelf_author', 'c0'],
    ]),
  );

  expect(lagging).toStrictEqual(['shelf_loan', 'shelf_author']);
});

test('it collects a consumer that the store has never seen', () => {
  const lagging = collectLaggingConsumers([{ name: 'shelf_book', version: 'a1' }], new Map());

  expect(lagging).toStrictEqual(['shelf_book']);
});

test('it collects none when every consumer has its listed version as current', () => {
  const lagging = collectLaggingConsumers(
    [{ name: 'shelf_book', version: 'a1' }],
    new Map([['shelf_book', 'a1']]),
  );

  expect(lagging).toStrictEqual([]);
});

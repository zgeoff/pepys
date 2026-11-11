import { expect, test } from 'bun:test';
import { buildStubConsumer } from './build-stub-consumer.ts';

test('it fills every field the test leaves out with an empty value', () => {
  expect(buildStubConsumer({ name: 'ledger_till' })).toStrictEqual({
    name: 'ledger_till',
    entry: new URL('file:///stub/consumers/stub.ts'),
    input: { mode: 'fact', streams: [] },
    tables: {},
    entityViews: [],
    reads: [],
    links: [],
  });
});

test('it keeps each field the test gives', () => {
  const consumer = buildStubConsumer({
    name: 'ledger_till',
    input: { mode: 'scope', scopeKind: 'ledger:till', streams: ['facts.ledger.till'] },
  });

  expect(consumer.input).toStrictEqual({
    mode: 'scope',
    scopeKind: 'ledger:till',
    streams: ['facts.ledger.till'],
  });
});

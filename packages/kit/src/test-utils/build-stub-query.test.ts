import { expect, test } from 'bun:test';
import { buildStubQuery } from './build-stub-query.ts';

test('it fills every field the test leaves out', () => {
  expect(buildStubQuery({ name: 'ledger_open_tills' })).toStrictEqual({
    name: 'ledger_open_tills',
    description: 'A stub query.',
    input: expect.any(Object),
    output: expect.any(Object),
    reads: [],
    handler: expect.any(Function),
  });
});

test('it keeps each field the test gives', () => {
  const query = buildStubQuery({ name: 'ledger_open_tills', description: 'Lists the open tills.' });

  expect(query.description).toBe('Lists the open tills.');
});

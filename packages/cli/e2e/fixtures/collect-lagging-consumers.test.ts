import { expect, test } from 'bun:test';
import { collectLaggingConsumers } from './collect-lagging-consumers.ts';

test('it leaves out a consumer that applied the last fact of its stream', () => {
  const lagging = collectLaggingConsumers(
    [
      {
        name: 'harbour',
        stream: 'facts.harbour',
        offsets: [{ stream: 'facts.harbour', lastSeqNum: 4 }],
      },
    ],
    new Map([['facts.harbour', 5]]),
  );

  expect(lagging).toStrictEqual([]);
});

test.each([
  { case: 'behind its tail', offsets: [{ stream: 'facts.harbour', lastSeqNum: 3 }] },
  { case: 'with no offset on its stream', offsets: [{ stream: 'facts.reef', lastSeqNum: 4 }] },
  { case: 'with no current version', offsets: null },
])('it names a consumer $case', (row) => {
  const lagging = collectLaggingConsumers(
    [{ name: 'harbour', stream: 'facts.harbour', offsets: row.offsets }],
    new Map([['facts.harbour', 5]]),
  );

  expect(lagging).toStrictEqual(['harbour']);
});

test('it leaves out a consumer whose stream holds no fact', () => {
  const lagging = collectLaggingConsumers(
    [{ name: 'harbour', stream: 'facts.harbour', offsets: null }],
    new Map([['facts.harbour', 0]]),
  );

  expect(lagging).toStrictEqual([]);
});

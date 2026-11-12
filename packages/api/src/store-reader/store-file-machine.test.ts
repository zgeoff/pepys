import { expect, test } from 'bun:test';
import { getInitialSnapshot, getNextSnapshot } from 'xstate';
import { storeFileMachine } from './store-file-machine.ts';

test('it starts open with no readers', () => {
  const snapshot = getInitialSnapshot(storeFileMachine);

  expect({ value: snapshot.value, context: snapshot.context }).toStrictEqual({
    value: 'open',
    context: { readers: 0 },
  });
});

test.each([
  { from: 'open', readers: 0, event: 'hold', to: 'open', after: 1 },
  { from: 'open', readers: 2, event: 'hold', to: 'open', after: 3 },
  { from: 'open', readers: 2, event: 'release', to: 'open', after: 1 },
  { from: 'open', readers: 2, event: 'retire', to: 'retiredWithReaders', after: 2 },
  { from: 'open', readers: 0, event: 'retire', to: 'retiredIdle', after: 0 },
  { from: 'open', readers: 1, event: 'close', to: 'closed', after: 1 },
  { from: 'retiredWithReaders', readers: 2, event: 'release', to: 'retiredWithReaders', after: 1 },
  { from: 'retiredWithReaders', readers: 1, event: 'release', to: 'retiredIdle', after: 0 },
  { from: 'retiredWithReaders', readers: 1, event: 'close', to: 'closed', after: 1 },
  { from: 'retiredIdle', readers: 0, event: 'close', to: 'closed', after: 0 },
] as const)('it moves from $from with $readers readers on $event to $to', (row) => {
  const snapshot = storeFileMachine.resolveState({
    value: row.from,
    context: { readers: row.readers },
  });

  const next = getNextSnapshot(storeFileMachine, snapshot, { type: row.event });

  expect({ value: next.value, context: next.context }).toStrictEqual({
    value: row.to,
    context: { readers: row.after },
  });
});

test.each([
  { from: 'open', readers: 0, event: 'release' },
  { from: 'retiredWithReaders', readers: 1, event: 'hold' },
  { from: 'retiredWithReaders', readers: 1, event: 'retire' },
  { from: 'retiredIdle', readers: 0, event: 'hold' },
  { from: 'retiredIdle', readers: 0, event: 'release' },
  { from: 'retiredIdle', readers: 0, event: 'retire' },
  { from: 'closed', readers: 0, event: 'hold' },
  { from: 'closed', readers: 1, event: 'release' },
  { from: 'closed', readers: 0, event: 'retire' },
  { from: 'closed', readers: 0, event: 'close' },
] as const)('it refuses $event in $from with $readers readers', (row) => {
  const snapshot = storeFileMachine.resolveState({
    value: row.from,
    context: { readers: row.readers },
  });

  expect(snapshot.can({ type: row.event })).toBeFalse();
});

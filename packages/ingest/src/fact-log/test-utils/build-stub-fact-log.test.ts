import { expect, test } from 'bun:test';
import type { EntityID, FactID, StreamName, StreamOffset } from '@pepys/schema';
import { toTagged } from '@zgeoff/std';
import { buildStubFactLog } from './build-stub-fact-log.ts';

test('it gives the same outcome to every append', async () => {
  const log = buildStubFactLog({ kind: 'rejected', reason: 'tail-mismatch' });

  const fact = {
    id: toTagged<FactID>('webhook:github:d-1'),
    type: 'github.pull_request.opened',
    v: 1,
    api: 'github/2022-11-28',
    entity: toTagged<EntityID>('github:pr:77'),
    at: '2026-10-02T10:30:00Z',
    payload: {},
  } as const;

  const outcomes = [
    await log.append(
      toTagged<StreamName>('facts.github.pull_request'),
      fact,
      toTagged<StreamOffset>(0),
    ),
    await log.append(
      toTagged<StreamName>('facts.github.pull_request'),
      fact,
      toTagged<StreamOffset>(5),
    ),
  ];

  expect(outcomes).toStrictEqual([
    { kind: 'rejected', reason: 'tail-mismatch' },
    { kind: 'rejected', reason: 'tail-mismatch' },
  ]);
});

test('it reports the tail as 0', async () => {
  const log = buildStubFactLog({ kind: 'unknown' });

  const tail = await log.readTail(toTagged<StreamName>('facts.github.pull_request'));

  expect(tail).toStrictEqual({ ok: true, value: toTagged<StreamOffset>(0) });
});

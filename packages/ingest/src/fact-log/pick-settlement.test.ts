import { expect, test } from 'bun:test';
import type { FactID } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import { buildTestFact } from '../test-utils/build-test-fact.ts';
import { pickSettlement } from './pick-settlement.ts';
import { buildTestStoredFact } from './test-utils/build-test-stored-fact.ts';

test.each([
  ['nothing is stored at the offsets', [], 'not-landed'],
  [
    'every ID matches in order',
    [
      ['event:x:1', 4],
      ['event:x:2', 5],
    ],
    'landed',
  ],
  ['only a prefix of the IDs is stored', [['event:x:1', 4]], 'taken'],
  [
    'the IDs match in another order',
    [
      ['event:x:2', 4],
      ['event:x:1', 5],
    ],
    'taken',
  ],
  [
    'the first ID matches and the second differs',
    [
      ['event:x:1', 4],
      ['event:x:9', 5],
    ],
    'taken',
  ],
] as const)('it picks the settlement of an attempt when %s', (_title, stored, settlement) => {
  const run = [toTagged<FactID>('event:x:1'), toTagged<FactID>('event:x:2')];

  const picked = pickSettlement(
    run,
    stored.map(([id, offset]) => buildTestStoredFact(buildTestFact(id), offset)),
  );

  expect(picked).toBe(settlement);
});

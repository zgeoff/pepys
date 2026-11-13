import { expect, test } from 'bun:test';
import type { StreamOffset } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import { buildTestFact } from '../../test-utils/build-test-fact.ts';
import { buildTestStoredFact } from './build-test-stored-fact.ts';

test('it builds a stored fact with the offset and the body of its envelope', () => {
  const fact = buildTestFact('event:test:a');

  expect(buildTestStoredFact(fact, 4)).toStrictEqual({
    offset: toTagged<StreamOffset>(4),
    fact,
    body: JSON.stringify(fact),
    appendedAtMs: 0,
  });
});

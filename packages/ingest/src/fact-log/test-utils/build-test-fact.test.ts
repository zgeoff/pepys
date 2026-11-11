import { expect, test } from 'bun:test';
import { parseFactEnvelope } from '@pepys/kit';
import { buildTestFact } from './build-test-fact.ts';

test('it builds an envelope that passes the envelope parse', () => {
  const fact = buildTestFact('event:test:a', { note: 'n' });

  expect(parseFactEnvelope(fact)).toStrictEqual({
    ok: true,
    value: fact,
  });
});

test('it gives the envelope the ID and the payload it is given', () => {
  const fact = buildTestFact('event:test:b', { note: 'n' });

  expect([fact.id, fact.payload]).toStrictEqual(['event:test:b', { note: 'n' }]);
});

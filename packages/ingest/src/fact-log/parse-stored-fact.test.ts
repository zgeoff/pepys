import { expect, test } from 'bun:test';
import type { EntityID, FactID, StreamOffset } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import { parseStoredFact } from './parse-stored-fact.ts';

test('it returns the envelope a body holds beside the body and its appended-at time', () => {
  const body = `{"id":"manual:${'a'.repeat(64)}","type":"link.asserted","v":1,"api":"pepys/1","entity":"gmail:msg:17","at":"2026-10-01T08:00:00Z","payload":{}}`;
  const stored = parseStoredFact(toTagged<StreamOffset>(4), body, 1_790_000_000_000);

  expect(stored).toStrictEqual({
    offset: toTagged<StreamOffset>(4),
    fact: {
      id: toTagged<FactID>(`manual:${'a'.repeat(64)}`),
      type: 'link.asserted',
      v: 1,
      api: 'pepys/1',
      entity: toTagged<EntityID>('gmail:msg:17'),
      at: '2026-10-01T08:00:00Z',
      payload: {},
    },
    body,
    appendedAtMs: 1_790_000_000_000,
  });
});

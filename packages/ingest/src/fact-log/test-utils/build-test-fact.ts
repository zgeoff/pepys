import type { EntityID, FactEnvelope, FactID } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';

// An envelope that passes the envelope parse, for a test that needs a fact and no particular one.
export function buildTestFact(id: string, payload: unknown = {}): FactEnvelope<unknown> {
  return {
    id: toTagged<FactID>(id),
    type: 'link.asserted',
    v: 1,
    api: 'pepys/1',
    entity: toTagged<EntityID>('gmail:msg:17'),
    at: '2026-10-01T08:00:00Z',
    payload,
  };
}

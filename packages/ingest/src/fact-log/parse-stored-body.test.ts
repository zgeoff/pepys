import { expect, test } from 'bun:test';
import type { EntityID, FactID } from '@pepys/schema';
import { toTagged } from '@zgeoff/std';
import { parseStoredBody } from './parse-stored-body.ts';

test('it returns the JSON of an envelope that parses', () => {
  const body = parseStoredBody({
    id: toTagged<FactID>('webhook:github:d-1'),
    type: 'github.pull_request.opened',
    v: 1,
    api: 'github/2022-11-28',
    entity: toTagged<EntityID>('github:pr:77'),
    at: '2026-10-02T10:30:00Z',
    payload: { number: 77 },
  });

  expect(body).toBe(
    '{"id":"webhook:github:d-1","type":"github.pull_request.opened","v":1,"api":"github/2022-11-28","entity":"github:pr:77","at":"2026-10-02T10:30:00Z","payload":{"number":77}}',
  );
});

test.each([
  ['a payload that JSON drops', () => 'not JSON'],
  ['a payload that JSON cannot hold', 77n],
])('it returns null for %s', (_title, payload) => {
  const body = parseStoredBody({
    id: toTagged<FactID>('webhook:github:d-1'),
    type: 'github.pull_request.opened',
    v: 1,
    api: 'github/2022-11-28',
    entity: toTagged<EntityID>('github:pr:77'),
    at: '2026-10-02T10:30:00Z',
    payload,
  });

  expect(body).toBeNull();
});

test('it returns null for an envelope whose fact ID fails the envelope parse', () => {
  const body = parseStoredBody({
    id: toTagged<FactID>('not-a-fact-id'),
    type: 'github.pull_request.opened',
    v: 1,
    api: 'github/2022-11-28',
    entity: toTagged<EntityID>('github:pr:77'),
    at: '2026-10-02T10:30:00Z',
    payload: {},
  });

  expect(body).toBeNull();
});

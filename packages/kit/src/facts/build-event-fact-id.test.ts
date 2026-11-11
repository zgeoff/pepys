import { expect, test } from 'bun:test';
import { parseEntityID } from '../entity-ids/parse-entity-id.ts';
import { buildEventFactID } from './build-event-fact-id.ts';
import { parseFactEnvelope } from './parse-fact-envelope.ts';

test('it builds an event fact ID from the source and the event ID', () => {
  const actual: unknown = buildEventFactID({ source: 'ledger', event: 'evt-3c1d' });

  expect(actual).toBe('event:ledger:evt-3c1d');
});

test('it keeps the colons and dots of the event ID', () => {
  const actual: unknown = buildEventFactID({ source: 'ledger', event: 'till.opened:t-4' });

  expect(actual).toBe('event:ledger:till.opened:t-4');
});

test('it gives an ID that is not an entity ID', () => {
  const factID = buildEventFactID({ source: 'ledger', event: 'evt-3c1d' });

  expect(parseEntityID(factID).ok).toBe(false);
});

test('it gives an ID that the envelope parser accepts', () => {
  const result = parseFactEnvelope({
    id: buildEventFactID({ source: 'ledger', event: 'evt-3c1d' }),
    type: 'ledger.till.opened',
    v: 1,
    api: 'ledger/1',
    entity: 'ledger:till:4',
    at: '2026-10-24T01:02:03Z',
    payload: {},
  });

  expect(result.ok).toBe(true);
});

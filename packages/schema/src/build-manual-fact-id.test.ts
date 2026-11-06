import { expect, test } from 'bun:test';
import { toTagged } from '@zgeoff/std';
import { buildManualFactID } from './build-manual-fact-id.ts';
import type { ClientID, RequestID } from './ids/ids.ts';
import { parseEntityID } from './parse-entity-id.ts';

test('it starts a manual fact ID with its kind and a sha256 hash', () => {
  expect(
    buildManualFactID(toTagged<ClientID>('client-ledger'), toTagged<RequestID>('request-1')),
  ).toMatch(/^manual:[0-9a-f]{64}$/u);
});

test('it gives the same ID when one client repeats a request ID', () => {
  expect(
    buildManualFactID(toTagged<ClientID>('client-ledger'), toTagged<RequestID>('request-1')),
  ).toBe(buildManualFactID(toTagged<ClientID>('client-ledger'), toTagged<RequestID>('request-1')));
});

test('it gives another ID for the same request ID from another client', () => {
  expect(
    buildManualFactID(toTagged<ClientID>('client-ledger'), toTagged<RequestID>('request-1')),
  ).not.toBe(
    buildManualFactID(toTagged<ClientID>('client-atlas'), toTagged<RequestID>('request-1')),
  );
});

test('it gives another ID for another request ID from the same client', () => {
  expect(
    buildManualFactID(toTagged<ClientID>('client-ledger'), toTagged<RequestID>('request-1')),
  ).not.toBe(
    buildManualFactID(toTagged<ClientID>('client-ledger'), toTagged<RequestID>('request-2')),
  );
});

test('it keeps the boundary between the client ID and the request ID', () => {
  expect(buildManualFactID(toTagged<ClientID>('ab'), toTagged<RequestID>('c'))).not.toBe(
    buildManualFactID(toTagged<ClientID>('a'), toTagged<RequestID>('bc')),
  );
});

test('it gives an ID that is not an entity ID', () => {
  const factID = buildManualFactID(
    toTagged<ClientID>('client-ledger'),
    toTagged<RequestID>('request-1'),
  );

  expect(parseEntityID(factID).ok).toBe(false);
});

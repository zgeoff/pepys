import { expect, test } from 'bun:test';
import { buildManualFactID } from './build-manual-fact-id.ts';
import { parseEntityID } from './parse-entity-id.ts';

test('it starts a manual fact ID with its kind and a UUIDv7', () => {
  expect(buildManualFactID()).toMatch(
    /^manual:[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  );
});

test('it gives another ID on each call', () => {
  expect(buildManualFactID()).not.toBe(buildManualFactID());
});

test('it gives an ID that is not an entity ID', () => {
  expect(parseEntityID(buildManualFactID()).ok).toBe(false);
});

import { expect, test } from 'bun:test';
import { buildWebhookFactID } from './build-webhook-fact-id.ts';
import { parseEntityID } from './parse-entity-id.ts';

test('it builds a webhook fact ID from the source and the delivery ID', () => {
  const actual: unknown = buildWebhookFactID({ source: 'github', deliveryID: 'd-4f1c' });

  expect(actual).toBe('webhook:github:d-4f1c');
});

test('it gives the same ID for the same delivery', () => {
  const parts = { source: 'github', deliveryID: 'd-4f1c' };

  expect(buildWebhookFactID(parts)).toStrictEqual(buildWebhookFactID(parts));
});

test('it gives an ID that is not an entity ID', () => {
  const factID = buildWebhookFactID({ source: 'github', deliveryID: 'd-4f1c' });

  expect(parseEntityID(factID).ok).toBe(false);
});

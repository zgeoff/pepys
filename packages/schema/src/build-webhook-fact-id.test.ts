import { expect, test } from 'bun:test';
import { buildWebhookFactID } from './build-webhook-fact-id.ts';
import { parseEntityID } from './parse-entity-id.ts';

test('it builds a webhook fact ID from the source and the delivery ID', () => {
  expect<unknown>(buildWebhookFactID({ source: 'github', deliveryID: 'd-4f1c' })).toBe(
    'webhook:github:d-4f1c',
  );
});

test('it gives the same ID for the same delivery', () => {
  const parts = { source: 'github', deliveryID: 'd-4f1c' };

  expect<unknown>(buildWebhookFactID(parts)).toStrictEqual(buildWebhookFactID(parts));
});

test('it gives an ID that is not an entity ID', () => {
  const factID = buildWebhookFactID({ source: 'github', deliveryID: 'd-4f1c' });

  expect<unknown>(parseEntityID(factID).ok).toBe(false);
});

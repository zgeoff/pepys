import type { Delivery, Received } from '@pepys/kit';
import { buildGithubFact } from './build-github-fact.ts';

// The read of a checked webhook delivery: the event's rule makes one fact, and an event with no
// rule is ignored. The delivery ID is required and goes in no fact.
export function readGithubDelivery(delivery: Delivery): Received {
  const event = delivery.headers.get('x-github-event') ?? '';
  const deliveryID = delivery.headers.get('x-github-delivery');

  if (deliveryID === null || deliveryID === '') {
    return { kind: 'refused', status: 400, reason: 'no delivery ID' };
  }

  const body = parseJSON(new TextDecoder().decode(delivery.body));

  if (!body.ok) {
    return { kind: 'refused', status: 400, reason: 'the body is not JSON' };
  }

  const fact = buildGithubFact(event, body.value, 'delivery');

  if (fact === 'ignored') {
    return { kind: 'ignored' };
  }

  if (fact === 'invalid') {
    return { kind: 'refused', status: 422, reason: `not a ${event} delivery` };
  }

  return { kind: 'batch', batch: { facts: [fact] } };
}

function parseJSON(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    const value: unknown = JSON.parse(text);

    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

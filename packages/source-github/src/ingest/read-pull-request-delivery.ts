import type { Delivery, Received } from '@pepys/kit';
import { buildPullRequestFact } from './build-pull-request-fact.ts';
import { pullRequestStream } from './pull-request-stream.ts';

// The read of a checked webhook delivery: a pull request event becomes one fact, and any other event
// is ignored.
export function readPullRequestDelivery(delivery: Delivery): Received {
  if (delivery.headers.get('x-github-event') !== 'pull_request') {
    return { kind: 'ignored' };
  }

  const deliveryID = delivery.headers.get('x-github-delivery');

  if (deliveryID === null || deliveryID === '') {
    return { kind: 'refused', status: 400, reason: 'no delivery ID' };
  }

  const body = parseJSON(new TextDecoder().decode(delivery.body));

  if (!body.ok) {
    return { kind: 'refused', status: 400, reason: 'the body is not JSON' };
  }

  const fact = buildPullRequestFact({ deliveryID, body: body.value });

  if (!fact.ok) {
    return { kind: 'refused', status: 422, reason: 'not a pull request delivery' };
  }

  return {
    kind: 'batch',
    batch: { facts: [{ stream: pullRequestStream, fact: fact.value, blobs: [] }] },
  };
}

function parseJSON(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    const value: unknown = JSON.parse(text);

    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

import { Webhooks } from '@octokit/webhooks';
import type { FactEnvelope } from '@pepys/schema';
import { buildPullRequestFact } from './build-pull-request-fact.ts';

interface WebhookReceiverDependencies {
  secret: string;
  appendFact: (fact: FactEnvelope<unknown>) => Promise<void>;
}

// The receiver checks the signature of the raw body before it reads anything else from the
// request, then turns a pull request delivery into one fact and acknowledges every other event.
export function makeWebhookReceiver(
  dependencies: WebhookReceiverDependencies,
): (request: Request) => Promise<Response> {
  const webhooks = new Webhooks({ secret: dependencies.secret });

  return async (request) => {
    if (request.method !== 'POST') {
      return Response.json({ error: 'method not allowed' }, { status: 405 });
    }

    const body = await request.text();

    const signature = request.headers.get('x-hub-signature-256');

    if (signature === null || !(await probeSignature(webhooks, body, signature))) {
      return Response.json({ error: 'bad signature' }, { status: 401 });
    }

    if (request.headers.get('x-github-event') !== 'pull_request') {
      return Response.json({ status: 'ignored' }, { status: 202 });
    }

    const deliveryID = request.headers.get('x-github-delivery');

    if (deliveryID === null || deliveryID === '') {
      return Response.json({ error: 'no delivery ID' }, { status: 400 });
    }

    const parsedBody = parseJSON(body);

    if (!parsedBody.ok) {
      return Response.json({ error: 'body is not JSON' }, { status: 400 });
    }

    const fact = buildPullRequestFact({ deliveryID, body: parsedBody.value });

    if (!fact.ok) {
      return Response.json({ error: 'not a pull request delivery' }, { status: 422 });
    }

    try {
      await dependencies.appendFact(fact.value);
    } catch (error: unknown) {
      console.error('the fact was not appended', error);

      return Response.json({ error: 'fact not stored' }, { status: 502 });
    }

    return Response.json({ status: 'accepted', fact: fact.value.id }, { status: 202 });
  };
}

// verify throws on a signature that is not hex and on an empty body, and both mean a bad signature.
async function probeSignature(
  webhooks: Webhooks,
  body: string,
  signature: string,
): Promise<boolean> {
  try {
    return await webhooks.verify(body, signature);
  } catch {
    return false;
  }
}

function parseJSON(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    const value: unknown = JSON.parse(text);

    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

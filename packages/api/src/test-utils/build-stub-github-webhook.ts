import type { ReceivePath } from '@pepys/ingest';
import { buildWebhookFactID } from '@pepys/schema';
import type { EntityID, StreamName } from '@pepys/schema';
import { toTagged } from '@zgeoff/std';
import { reviewRequestPayloadSchema } from './review-request-payload-schema.ts';

interface StubGitHubWebhook {
  secret: string;
  stream: StreamName;
}

export function buildStubGitHubWebhook(options: StubGitHubWebhook): ReceivePath {
  return {
    kind: 'receive',
    route: '/webhooks/github',
    receive: async (request) => {
      const body = await request.text();

      const digest = new Bun.CryptoHasher('sha256', options.secret).update(body).digest('hex');

      if (request.headers.get('x-hub-signature-256') !== `sha256=${digest}`) {
        return { kind: 'refused', status: 401, reason: 'bad signature' };
      }

      const payload = reviewRequestPayloadSchema.parse(JSON.parse(body));
      const delivery = request.headers.get('x-github-delivery') ?? '';

      return {
        kind: 'batch',
        batch: {
          facts: [
            {
              stream: options.stream,
              blobs: [],
              fact: {
                id: buildWebhookFactID({ source: 'github', deliveryID: delivery }),
                type: 'pull_request.review_requested',
                v: 1,
                api: 'github/2022-11-28',
                entity: toTagged<EntityID>(`github:pr:${payload.pull_request.id}`),
                at: '2026-10-01T08:00:00Z',
                payload,
              },
            },
          ],
        },
      };
    },
  };
}

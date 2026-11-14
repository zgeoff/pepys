import { match } from 'ts-pattern';
import { buildGithubDelivery } from '../../packages/cli/src/test-utils/build-github-delivery.ts';
import type { GithubDelivery } from '../../packages/cli/src/test-utils/build-github-delivery.ts';
import { buildGithubReleaseDelivery } from '../../packages/cli/src/test-utils/build-github-release-delivery.ts';
import { buildGithubReviewDelivery } from '../../packages/cli/src/test-utils/build-github-review-delivery.ts';

export interface WebhookInput {
  event: 'opened' | 'reviewed' | 'merged' | 'released';
  number?: number | undefined;
  title?: string | undefined;
  tag?: string | undefined;
  at: string;
  count: number;
}

type Built = { ok: true; deliveries: GithubDelivery[] } | { ok: false; message: string };

// The deliveries of one `send-webhook`: `count` pull requests from `number` up for `opened`, and one
// delivery for each other event. Each delivery ID follows from the event, so a journey run twice
// sends the same deliveries, and ingest stores each body once.
export function buildWebhookDeliveries(input: WebhookInput): Built {
  if (input.count > 1 && input.event !== 'opened') {
    return { ok: false, message: '--count sends many pull requests, so it takes --event opened' };
  }

  return match(input.event)
    .with('released', () =>
      input.tag === undefined
        ? { ok: false as const, message: '--event released needs --tag' }
        : {
            ok: true as const,
            deliveries: [
              buildGithubReleaseDelivery({
                deliveryID: `verify-released-${input.tag}-${input.at}`,
                tag: input.tag,
                publishedAt: input.at,
              }),
            ],
          },
    )
    .with('reviewed', () =>
      input.number === undefined
        ? { ok: false as const, message: '--event reviewed needs --number' }
        : {
            ok: true as const,
            deliveries: [
              buildGithubReviewDelivery({
                deliveryID: `verify-reviewed-${input.number}-${input.at}`,
                number: input.number,
                submittedAt: input.at,
              }),
            ],
          },
    )
    .with('opened', 'merged', (event) =>
      input.number === undefined || input.title === undefined
        ? { ok: false as const, message: `--event ${event} needs --number and --title` }
        : {
            ok: true as const,
            deliveries: buildPullRequestDeliveries(event, {
              number: input.number,
              title: input.title,
              at: input.at,
              count: input.count,
            }),
          },
    )
    .exhaustive();
}

interface PullRequestRange {
  number: number;
  title: string;
  at: string;
  count: number;
}

function buildPullRequestDeliveries(
  event: 'opened' | 'merged',
  input: PullRequestRange,
): GithubDelivery[] {
  return Array.from({ length: input.count }, (_, index) => {
    const number = input.number + index;
    const title = input.count === 1 ? input.title : `${input.title} ${number}`;

    return buildGithubDelivery({
      deliveryID: `verify-${event}-${number}-${input.at}`,
      action: event === 'opened' ? 'opened' : 'closed',
      title,
      updatedAt: input.at,
      number,
      ...(event === 'merged' ? { mergedAt: input.at } : {}),
    });
  });
}

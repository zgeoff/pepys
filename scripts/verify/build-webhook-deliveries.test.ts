import { expect, test } from 'bun:test';
import { buildGithubDelivery } from '../../packages/cli/src/test-utils/build-github-delivery.ts';
import { buildGithubReleaseDelivery } from '../../packages/cli/src/test-utils/build-github-release-delivery.ts';
import { buildGithubReviewDelivery } from '../../packages/cli/src/test-utils/build-github-review-delivery.ts';
import { buildWebhookDeliveries } from './build-webhook-deliveries.ts';

test('it builds one opened pull request per count, numbered up from the first', () => {
  const built = buildWebhookDeliveries({
    event: 'opened',
    number: 40,
    title: 'Sound the channel',
    at: '2026-10-05T08:00:00Z',
    count: 2,
  });

  expect(built).toStrictEqual({
    ok: true,
    deliveries: [
      buildGithubDelivery({
        deliveryID: 'verify-opened-40-2026-10-05T08:00:00Z',
        action: 'opened',
        title: 'Sound the channel 40',
        updatedAt: '2026-10-05T08:00:00Z',
        number: 40,
      }),
      buildGithubDelivery({
        deliveryID: 'verify-opened-41-2026-10-05T08:00:00Z',
        action: 'opened',
        title: 'Sound the channel 41',
        updatedAt: '2026-10-05T08:00:00Z',
        number: 41,
      }),
    ],
  });
});

test('it keeps the title of a single opened pull request as given', () => {
  const built = buildWebhookDeliveries({
    event: 'opened',
    number: 31,
    title: 'Light the breakwater',
    at: '2026-10-02T08:00:00Z',
    count: 1,
  });

  expect(built).toStrictEqual({
    ok: true,
    deliveries: [
      buildGithubDelivery({
        deliveryID: 'verify-opened-31-2026-10-02T08:00:00Z',
        action: 'opened',
        title: 'Light the breakwater',
        updatedAt: '2026-10-02T08:00:00Z',
        number: 31,
      }),
    ],
  });
});

test('it builds a merged pull request as a closed delivery with its merge time', () => {
  const built = buildWebhookDeliveries({
    event: 'merged',
    number: 31,
    title: 'Light the breakwater',
    at: '2026-10-02T11:00:00Z',
    count: 1,
  });

  expect(built).toStrictEqual({
    ok: true,
    deliveries: [
      buildGithubDelivery({
        deliveryID: 'verify-merged-31-2026-10-02T11:00:00Z',
        action: 'closed',
        title: 'Light the breakwater',
        updatedAt: '2026-10-02T11:00:00Z',
        number: 31,
        mergedAt: '2026-10-02T11:00:00Z',
      }),
    ],
  });
});

test('it builds an approving review of the pull request with the number', () => {
  const built = buildWebhookDeliveries({
    event: 'reviewed',
    number: 31,
    at: '2026-10-02T09:00:00Z',
    count: 1,
  });

  expect(built).toStrictEqual({
    ok: true,
    deliveries: [
      buildGithubReviewDelivery({
        deliveryID: 'verify-reviewed-31-2026-10-02T09:00:00Z',
        number: 31,
        submittedAt: '2026-10-02T09:00:00Z',
      }),
    ],
  });
});

test('it builds a published release with the tag', () => {
  const built = buildWebhookDeliveries({
    event: 'released',
    tag: 'v2.1.0',
    at: '2026-10-03T08:00:00Z',
    count: 1,
  });

  expect(built).toStrictEqual({
    ok: true,
    deliveries: [
      buildGithubReleaseDelivery({
        deliveryID: 'verify-released-v2.1.0-2026-10-03T08:00:00Z',
        tag: 'v2.1.0',
        publishedAt: '2026-10-03T08:00:00Z',
      }),
    ],
  });
});

test.each([
  {
    case: 'an opened pull request with no title',
    event: 'opened',
    number: 31,
    tag: undefined,
    count: 1,
  },
  {
    case: 'a review with no number',
    event: 'reviewed',
    number: undefined,
    tag: undefined,
    count: 1,
  },
  { case: 'a release with no tag', event: 'released', number: undefined, tag: undefined, count: 1 },
  { case: 'a count of reviews', event: 'reviewed', number: 31, tag: undefined, count: 2 },
] as const)('it refuses $case', (row) => {
  const built = buildWebhookDeliveries({
    event: row.event,
    number: row.number,
    tag: row.tag,
    at: '2026-10-02T09:00:00Z',
    count: row.count,
  });

  expect(built).toMatchObject({ ok: false });
});

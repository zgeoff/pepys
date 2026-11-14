import { expect, test } from 'bun:test';
import { buildGithubReviewDelivery } from './build-github-review-delivery.ts';

test('it builds an approving review of the pull request with the number', () => {
  const delivery = buildGithubReviewDelivery({
    deliveryID: 'd-3',
    number: 31,
    submittedAt: '2026-10-02T09:00:00Z',
  });

  const body: unknown = JSON.parse(delivery.body);

  expect({ ...delivery, body }).toStrictEqual({
    deliveryID: 'd-3',
    event: 'pull_request_review',
    body: {
      action: 'submitted',
      review: {
        id: 3_100_031,
        state: 'approved',
        user: { id: 5502 },
        submitted_at: '2026-10-02T09:00:00Z',
      },
      pull_request: {
        id: 1_874_433_040,
        number: 31,
        html_url: 'https://github.example/Acme/Harbour/pull/31',
        user: { id: 4401 },
        base: { repo: { id: 902 } },
        created_at: '2026-10-01T08:00:00Z',
        updated_at: '2026-10-02T09:00:00Z',
      },
      sender: { id: 5502 },
    },
  });
});

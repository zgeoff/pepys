import type { GithubDelivery } from './build-github-delivery.ts';
import { buildPullRequestFields } from './build-pull-request-fields.ts';

interface ReviewDeliveryParameters {
  deliveryID: string;
  number: number;
  submittedAt: string;
}

// The body of one `pull_request_review` delivery: an approving review of the invented pull request
// with the number, by user 5502. The review's GitHub ID follows from the pull request's number.
export function buildGithubReviewDelivery(parameters: ReviewDeliveryParameters): GithubDelivery {
  const body = JSON.stringify({
    action: 'submitted',
    review: {
      id: 3_100_000 + parameters.number,
      state: 'approved',
      user: { id: 5502 },
      submitted_at: parameters.submittedAt,
    },
    pull_request: buildPullRequestFields(parameters.number, parameters.submittedAt),
    sender: { id: 5502 },
  });

  return { deliveryID: parameters.deliveryID, event: 'pull_request_review', body };
}

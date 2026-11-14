import { buildPullRequestFields } from './build-pull-request-fields.ts';

export interface GithubDelivery {
  deliveryID: string;

  // the `x-github-event` header that GitHub sends with the body
  event: 'pull_request' | 'pull_request_review' | 'release';
  body: string;
}

interface GithubDeliveryParameters {
  deliveryID: string;
  action: string;
  title: string;
  updatedAt: string;

  // pull request 12 when absent
  number?: number;

  // absent: the pull request is open
  mergedAt?: string;
}

// The body of one `pull_request` webhook delivery of an invented pull request, before it is signed.
export function buildGithubDelivery(parameters: GithubDeliveryParameters): GithubDelivery {
  const number = parameters.number ?? 12;
  const mergedAt = parameters.mergedAt ?? null;

  const body = JSON.stringify({
    action: parameters.action,
    number,
    pull_request: {
      ...buildPullRequestFields(number, parameters.updatedAt),
      title: parameters.title,
      state: mergedAt === null ? 'open' : 'closed',
      draft: false,
      merged: mergedAt !== null,
      merge_commit_sha: mergedAt === null ? null : buildMergeCommitSHA(number),
      closed_at: mergedAt,
      merged_at: mergedAt,
    },
    sender: { id: 4401 },
  });

  return { deliveryID: parameters.deliveryID, event: 'pull_request', body };
}

// 40 hex digits, distinct for each pull request number
function buildMergeCommitSHA(number: number): string {
  return number.toString(16).padStart(40, 'c');
}

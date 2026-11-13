export interface GithubDelivery {
  deliveryID: string;
  body: string;
}

interface GithubDeliveryParameters {
  deliveryID: string;
  action: string;
  title: string;
  updatedAt: string;
}

// The body of one `pull_request` webhook delivery of an invented pull request, before it is signed.
export function buildGithubDelivery(parameters: GithubDeliveryParameters): GithubDelivery {
  const body = JSON.stringify({
    action: parameters.action,
    number: 12,
    pull_request: {
      id: 1_874_433_021,
      number: 12,
      title: parameters.title,
      state: 'open',
      draft: false,
      merged: false,
      merge_commit_sha: null,
      html_url: 'https://github.example/Acme/Harbour/pull/12',
      user: { id: 4401 },
      base: { repo: { id: 902 } },
      created_at: '2026-10-01T08:00:00Z',
      updated_at: parameters.updatedAt,
      closed_at: null,
      merged_at: null,
    },
    sender: { id: 4401 },
  });

  return { deliveryID: parameters.deliveryID, body };
}

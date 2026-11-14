import type { GithubDelivery } from './build-github-delivery.ts';

interface ReleaseDeliveryParameters {
  deliveryID: string;
  tag: string;
  publishedAt: string;
}

// The body of one `release` delivery: a published release of the invented repository Acme/Harbour,
// created when it was published. The release's GitHub ID follows from the tag's digits.
export function buildGithubReleaseDelivery(parameters: ReleaseDeliveryParameters): GithubDelivery {
  const body = JSON.stringify({
    action: 'published',
    release: {
      id: 7_700_000 + Number(parameters.tag.replaceAll(/\D/gu, '')),
      tag_name: parameters.tag,
      target_commitish: 'main',
      name: parameters.tag,
      html_url: `https://github.example/Acme/Harbour/releases/tag/${parameters.tag}`,
      draft: false,
      prerelease: false,
      created_at: parameters.publishedAt,
      published_at: parameters.publishedAt,
    },
    repository: { id: 902, full_name: 'Acme/Harbour' },
    sender: { id: 4401 },
  });

  return { deliveryID: parameters.deliveryID, event: 'release', body };
}

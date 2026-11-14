import { expect, test } from 'bun:test';
import { buildGithubReleaseDelivery } from './build-github-release-delivery.ts';

test('it builds a published release of Acme/Harbour with the tag', () => {
  const delivery = buildGithubReleaseDelivery({
    deliveryID: 'd-4',
    tag: 'v1.4.0',
    publishedAt: '2026-10-03T08:00:00Z',
  });

  const body: unknown = JSON.parse(delivery.body);

  expect({ ...delivery, body }).toStrictEqual({
    deliveryID: 'd-4',
    event: 'release',
    body: {
      action: 'published',
      release: {
        id: 7_700_140,
        tag_name: 'v1.4.0',
        target_commitish: 'main',
        name: 'v1.4.0',
        html_url: 'https://github.example/Acme/Harbour/releases/tag/v1.4.0',
        draft: false,
        prerelease: false,
        created_at: '2026-10-03T08:00:00Z',
        published_at: '2026-10-03T08:00:00Z',
      },
      repository: { id: 902, full_name: 'Acme/Harbour' },
      sender: { id: 4401 },
    },
  });
});

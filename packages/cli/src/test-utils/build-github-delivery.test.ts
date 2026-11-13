import { expect, test } from 'bun:test';
import { buildGithubDelivery } from './build-github-delivery.ts';

test('it builds a delivery whose body carries the title, action and update time', () => {
  const delivery = buildGithubDelivery({
    deliveryID: 'd-1',
    action: 'edited',
    title: 'Chart the reef',
    updatedAt: '2026-10-01T09:30:00Z',
  });

  expect(delivery.deliveryID).toBe('d-1');

  expect(JSON.parse(delivery.body)).toStrictEqual({
    action: 'edited',
    number: 12,
    pull_request: {
      id: 1_874_433_021,
      number: 12,
      title: 'Chart the reef',
      state: 'open',
      draft: false,
      merged: false,
      merge_commit_sha: null,
      html_url: 'https://github.example/acme/harbour/pull/12',
      user: { id: 4401 },
      base: { repo: { id: 902 } },
      created_at: '2026-10-01T08:00:00Z',
      updated_at: '2026-10-01T09:30:00Z',
      closed_at: null,
      merged_at: null,
    },
    sender: { id: 4401 },
  });
});

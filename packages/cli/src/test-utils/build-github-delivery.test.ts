import { expect, test } from 'bun:test';
import { buildGithubDelivery } from './build-github-delivery.ts';

test('it builds an open pull request 12 whose body carries the title, action and update time', () => {
  const delivery = buildGithubDelivery({
    deliveryID: 'd-1',
    action: 'edited',
    title: 'Chart the reef',
    updatedAt: '2026-10-01T09:30:00Z',
  });

  expect({ ...delivery, body: JSON.parse(delivery.body) }).toStrictEqual({
    deliveryID: 'd-1',
    event: 'pull_request',
    body: {
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
        html_url: 'https://github.example/Acme/Harbour/pull/12',
        user: { id: 4401 },
        base: { repo: { id: 902 } },
        created_at: '2026-10-01T08:00:00Z',
        updated_at: '2026-10-01T09:30:00Z',
        closed_at: null,
        merged_at: null,
      },
      sender: { id: 4401 },
    },
  });
});

test('it builds a merged pull request with the number, closed at its merge time', () => {
  const delivery = buildGithubDelivery({
    deliveryID: 'd-2',
    action: 'closed',
    title: 'Light the breakwater',
    updatedAt: '2026-10-02T11:00:00Z',
    number: 31,
    mergedAt: '2026-10-02T11:00:00Z',
  });

  expect(JSON.parse(delivery.body)).toStrictEqual({
    action: 'closed',
    number: 31,
    pull_request: {
      id: 1_874_433_040,
      number: 31,
      title: 'Light the breakwater',
      state: 'closed',
      draft: false,
      merged: true,
      merge_commit_sha: 'cccccccccccccccccccccccccccccccccccccc1f',
      html_url: 'https://github.example/Acme/Harbour/pull/31',
      user: { id: 4401 },
      base: { repo: { id: 902 } },
      created_at: '2026-10-01T08:00:00Z',
      updated_at: '2026-10-02T11:00:00Z',
      closed_at: '2026-10-02T11:00:00Z',
      merged_at: '2026-10-02T11:00:00Z',
    },
    sender: { id: 4401 },
  });
});

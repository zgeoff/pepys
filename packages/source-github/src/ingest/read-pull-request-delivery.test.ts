import { expect, test } from 'bun:test';
import { readPullRequestDelivery } from './read-pull-request-delivery.ts';

function setupTest() {
  return {
    read: (headers: Record<string, string>, body: string) =>
      readPullRequestDelivery({
        headers: new Headers(headers),
        body: new TextEncoder().encode(body),
      }),
  };
}

test('it reads a pull request delivery as one fact on the pull request stream', () => {
  const ctx = setupTest();

  const body = {
    action: 'opened',
    pull_request: { id: 77, updated_at: '2026-10-02T10:30:00Z' },
    sender: { id: 4401 },
  };

  const received = ctx.read(
    { 'x-github-event': 'pull_request', 'x-github-delivery': 'd-7' },
    JSON.stringify(body),
  );

  const actual: unknown = received;

  expect(actual).toStrictEqual({
    kind: 'batch',
    batch: {
      facts: [
        {
          stream: 'facts.github.pull_request',
          blobs: [],
          fact: {
            id: 'webhook:github:d-7',
            type: 'github.pull_request.opened',
            v: 1,
            api: 'github/2022-11-28',
            entity: 'github:pull_request:77',
            actor: 'github:user:4401',
            at: '2026-10-02T10:30:00Z',
            payload: body,
          },
        },
      ],
    },
  });
});

test('it ignores an event that is not a pull request', () => {
  const ctx = setupTest();

  const received = ctx.read(
    { 'x-github-event': 'ping', 'x-github-delivery': 'd-12' },
    JSON.stringify({ zen: 'Design for failure.', hook_id: 31 }),
  );

  expect(received).toStrictEqual({ kind: 'ignored' });
});

test.each([
  {
    row: 'no delivery ID',
    headers: { 'x-github-event': 'pull_request' },
    body: '{}',
    refused: { kind: 'refused', status: 400, reason: 'no delivery ID' },
  },
  {
    row: 'a body that is not JSON',
    headers: { 'x-github-event': 'pull_request', 'x-github-delivery': 'd-8' },
    body: 'not json',
    refused: { kind: 'refused', status: 400, reason: 'the body is not JSON' },
  },
  {
    row: 'a body with no pull request',
    headers: { 'x-github-event': 'pull_request', 'x-github-delivery': 'd-9' },
    body: '{"action":"opened"}',
    refused: { kind: 'refused', status: 422, reason: 'not a pull request delivery' },
  },
])('it refuses $row', (row) => {
  const ctx = setupTest();

  expect(ctx.read(row.headers, row.body)).toStrictEqual(row.refused);
});

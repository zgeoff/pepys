import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readGithubDelivery } from './read-github-delivery.ts';

function setupTest() {
  return {
    read: (headers: Record<string, string>, body: string) =>
      readGithubDelivery({
        headers: new Headers(headers),
        body: new TextEncoder().encode(body),
      }),
  };
}

test('it reads a pull request delivery as one fact with an ID from the canonical body', () => {
  const ctx = setupTest();

  const text =
    '{ "sender": { "id": 4401 }, "action": "opened", "pull_request": { "updated_at": "2026-10-02T10:30:00Z", "id": 77, "url": "https://api.github.com/repos/acme/harbour/pulls/3" } }';

  const canonical =
    '{"action":"opened","pull_request":{"id":77,"updated_at":"2026-10-02T10:30:00Z","url":"https://api.github.com/repos/acme/harbour/pulls/3"},"sender":{"id":4401}}';

  const hash = createHash('sha256').update(canonical).digest('hex');
  const payload: unknown = JSON.parse(text);
  const received = ctx.read({ 'x-github-event': 'pull_request', 'x-github-delivery': 'd-7' }, text);
  const actual: unknown = received;

  expect(actual).toStrictEqual({
    kind: 'batch',
    batch: {
      facts: [
        {
          stream: 'facts.github.pull_request',
          blobs: [],
          locator: '/repos/acme/harbour/pulls/3',
          fact: {
            id: `webhook:github:h-${hash}`,
            type: 'github.pull_request.opened',
            v: 1,
            api: 'github/2022-11-28',
            entity: 'github:pull_request:77',
            actor: 'github:user:4401',
            at: '2026-10-02T10:30:00Z',
            payload,
          },
        },
      ],
    },
  });
});

test('it gives one fact ID to one body under two delivery IDs, two spacings and two key orders', () => {
  const ctx = setupTest();

  const first = ctx.read(
    { 'x-github-event': 'release', 'x-github-delivery': 'd-1' },
    '{"action":"published","release":{"id":5,"created_at":"2026-10-01T09:00:00Z"}}',
  );

  const second = ctx.read(
    { 'x-github-event': 'release', 'x-github-delivery': 'd-2' },
    '{ "release": { "created_at": "2026-10-01T09:00:00Z", "id": 5 }, "action": "published" }',
  );

  const ids = [first, second].map((received) =>
    received.kind === 'batch' ? received.batch.facts[0]?.fact.id : received.kind,
  );

  expect(ids[0]).toStartWith('webhook:github:h-');
  expect(ids[1]).toBe(ids[0]);
});

test.each([
  {
    event: 'release',
    body: {
      action: 'published',
      release: {
        id: 5,
        url: 'https://api.github.com/repos/acme/harbour/releases/5',
        created_at: '2026-10-01T09:00:00Z',
        published_at: '2026-10-01T09:05:00Z',
        updated_at: '2026-10-01T09:06:00Z',
      },
    },
    fields: {
      stream: 'facts.github.release',
      type: 'github.release.published',
      entity: 'github:release:5',
      at: '2026-10-01T09:06:00Z',
      locator: '/repos/acme/harbour/releases/5',
    },
  },
  {
    event: 'push',
    body: {
      ref: 'refs/heads/main',
      repository: { id: 902, default_branch: 'main', pushed_at: 1_790_845_200 },
      head_commit: { timestamp: '2026-10-01T09:00:00+02:00' },
    },
    fields: {
      stream: 'facts.github.ref',
      type: 'github.ref.pushed',
      entity: 'github:ref:902:refs/heads/main',
      at: '2026-10-01T09:00:00.000Z',
      locator: undefined,
    },
  },
  {
    event: 'push',
    body: {
      ref: 'refs/tags/deployed/production',
      repository: { id: 902, default_branch: 'main', pushed_at: null },
      head_commit: { timestamp: '2026-10-01T09:00:00+02:00' },
    },
    fields: {
      stream: 'facts.github.ref',
      type: 'github.ref.pushed',
      entity: 'github:ref:902:refs/tags/deployed/production',
      at: '2026-10-01T07:00:00.000Z',
      locator: undefined,
    },
  },
  {
    event: 'deployment',
    body: { deployment: { id: 31, created_at: '2026-10-01T09:00:00Z' } },
    fields: {
      stream: 'facts.github.deployment',
      type: 'github.deployment.created',
      entity: 'github:deployment:31',
      at: '2026-10-01T09:00:00Z',
      locator: undefined,
    },
  },
  {
    event: 'deployment_status',
    body: {
      deployment_status: { state: 'success', created_at: '2026-10-01T09:02:00Z' },
      deployment: { id: 31 },
    },
    fields: {
      stream: 'facts.github.deployment',
      type: 'github.deployment.status_created',
      entity: 'github:deployment:31',
      at: '2026-10-01T09:02:00Z',
      locator: undefined,
    },
  },
  {
    event: 'workflow_run',
    body: { action: 'completed', workflow_run: { id: 61, updated_at: '2026-10-01T09:00:00Z' } },
    fields: {
      stream: 'facts.github.workflow_run',
      type: 'github.workflow_run.completed',
      entity: 'github:workflow_run:61',
      at: '2026-10-01T09:00:00Z',
      locator: undefined,
    },
  },
  {
    event: 'issues',
    body: { action: 'opened', issue: { id: 71, updated_at: '2026-10-01T09:00:00Z' } },
    fields: {
      stream: 'facts.github.issue',
      type: 'github.issue.opened',
      entity: 'github:issue:71',
      at: '2026-10-01T09:00:00Z',
      locator: undefined,
    },
  },
  {
    event: 'pull_request_review',
    body: {
      action: 'submitted',
      review: { id: 81, submitted_at: '2026-10-01T09:00:00Z' },
      pull_request: { updated_at: '2026-10-01T09:01:00Z' },
    },
    fields: {
      stream: 'facts.github.pull_request_review',
      type: 'github.pull_request_review.submitted',
      entity: 'github:pull_request_review:81',
      at: '2026-10-01T09:00:00Z',
      locator: undefined,
    },
  },
])('it reads a $event delivery as $fields.type', (row) => {
  const ctx = setupTest();

  const received = ctx.read(
    { 'x-github-event': row.event, 'x-github-delivery': 'd-1' },
    JSON.stringify(row.body),
  );

  const fact = received.kind === 'batch' ? received.batch.facts[0] : undefined;

  const actual: unknown = {
    stream: fact?.stream,
    type: fact?.fact.type,
    entity: fact?.fact.entity,
    at: fact?.fact.at,
    locator: fact?.locator,
  };

  expect(actual).toStrictEqual(row.fields);
});

test.each([
  {
    row: 'a push to a branch that is not the default',
    event: 'push',
    body: {
      ref: 'refs/heads/feature',
      repository: { id: 902, default_branch: 'main', pushed_at: 1_790_845_200 },
    },
  },
  {
    row: 'an action the family does not list',
    event: 'release',
    body: { action: 'archived', release: { id: 5, created_at: '2026-10-01T09:00:00Z' } },
  },
  { row: 'an event with no rule', event: 'ping', body: { zen: 'Keep it calm.', hook_id: 31 } },
])('it ignores $row', (row) => {
  const ctx = setupTest();

  const received = ctx.read(
    { 'x-github-event': row.event, 'x-github-delivery': 'd-12' },
    JSON.stringify(row.body),
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
    row: 'a pull request delivery with no pull request',
    headers: { 'x-github-event': 'pull_request', 'x-github-delivery': 'd-9' },
    body: '{"action":"opened"}',
    refused: { kind: 'refused', status: 422, reason: 'not a pull_request delivery' },
  },
  {
    row: 'an update time that is not a time',
    headers: { 'x-github-event': 'pull_request', 'x-github-delivery': 'd-10' },
    body: '{"action":"opened","pull_request":{"id":77,"updated_at":"yesterday"}}',
    refused: { kind: 'refused', status: 422, reason: 'not a pull_request delivery' },
  },
])('it refuses $row', (row) => {
  const ctx = setupTest();

  expect(ctx.read(row.headers, row.body)).toStrictEqual(row.refused);
});

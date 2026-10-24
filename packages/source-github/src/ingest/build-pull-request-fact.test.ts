import { expect, test } from 'bun:test';
import { buildPullRequestFact } from './build-pull-request-fact.ts';

test('it maps an opened delivery to a fact envelope around the whole body', () => {
  const body = {
    action: 'opened',
    number: 12,
    pull_request: { id: 1_874_433_021, number: 12, updated_at: '2026-10-01T09:00:00Z' },
    repository: { id: 902, full_name: 'acme/harbour' },
    sender: { id: 4401, login: 'tidewatcher' },
  };

  const fact = buildPullRequestFact({ deliveryID: 'c3a4-11f0-9b7e', body });
  const actual: unknown = fact;

  expect(actual).toStrictEqual({
    ok: true,
    value: {
      id: 'webhook:github:c3a4-11f0-9b7e',
      type: 'github.pull_request.opened',
      v: 1,
      api: 'github/2022-11-28',
      entity: 'github:pr:1874433021',
      actor: 'github:user:4401',
      at: '2026-10-01T09:00:00Z',
      payload: body,
    },
  });
});

test('it leaves the actor out when the delivery has no sender', () => {
  const body = {
    action: 'synchronize',
    pull_request: { id: 77, updated_at: '2026-10-02T10:30:00Z' },
  };

  const fact = buildPullRequestFact({ deliveryID: 'd-2', body });
  const actual: unknown = fact;

  expect(actual).toStrictEqual({
    ok: true,
    value: {
      id: 'webhook:github:d-2',
      type: 'github.pull_request.synchronize',
      v: 1,
      api: 'github/2022-11-28',
      entity: 'github:pr:77',
      at: '2026-10-02T10:30:00Z',
      payload: body,
    },
  });
});

test('it refuses a delivery without a pull request', () => {
  const fact = buildPullRequestFact({ deliveryID: 'd-3', body: { action: 'opened' } });

  expect(fact.ok).toBeFalse();
});

test('it refuses a pull request whose update time is not a timestamp', () => {
  const body = { action: 'opened', pull_request: { id: 77, updated_at: 'yesterday' } };
  const fact = buildPullRequestFact({ deliveryID: 'd-4', body });

  expect(fact.ok).toBeFalse();
});

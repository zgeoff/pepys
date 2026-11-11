import { expect, test } from 'bun:test';
import type { EntityID, FactID, StreamName } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import { buildStubGitHubWebhook } from './build-stub-github-webhook.ts';

test('it turns a request signed with its secret into a batch of one fact', async () => {
  const webhook = buildStubGitHubWebhook({
    secret: 'harbour-webhook-secret',
    stream: toTagged<StreamName>('facts.github.pull_request'),
  });

  const received = await webhook.receive(
    new Request('http://pepys.test/webhooks/github', {
      method: 'POST',
      headers: {
        'x-github-delivery': 'delivery-7',
        'x-hub-signature-256':
          'sha256=ec1e713bc814a55312bbd566139d9cc02fe90349bd00597a95ef32946af1bd7c',
      },
      body: '{"action":"review_requested","pull_request":{"id":12,"title":"Add the harbour map and tides"},"requested_reviewer":{"id":4401}}',
    }),
  );

  expect(received).toStrictEqual({
    kind: 'batch',
    batch: {
      facts: [
        {
          stream: toTagged<StreamName>('facts.github.pull_request'),
          blobs: [],
          fact: {
            id: toTagged<FactID>('webhook:github:delivery-7'),
            type: 'pull_request.review_requested',
            v: 1,
            api: 'github/2022-11-28',
            entity: toTagged<EntityID>('github:pull_request:12'),
            at: '2026-10-01T08:00:00Z',
            payload: {
              action: 'review_requested',
              pull_request: { id: 12, title: 'Add the harbour map and tides' },
              requested_reviewer: { id: 4401 },
            },
          },
        },
      ],
    },
  });
});

test.each([
  { name: 'no signature', headers: {} },
  {
    name: 'a signature made with another secret',
    headers: {
      'x-hub-signature-256':
        'sha256=c3c7224e99594dbd02ff0aaa182f47dbb195812d7191bd2811e7661354d1e265',
    },
  },
  {
    name: 'the signature of another body',
    headers: {
      'x-hub-signature-256':
        'sha256=e0dff66834192bb77a163027915bc1bd939b9dfbba1490c161ef495a47009e1d',
    },
  },
  {
    name: 'the right digest without its sha256= prefix',
    headers: {
      'x-hub-signature-256': 'ec1e713bc814a55312bbd566139d9cc02fe90349bd00597a95ef32946af1bd7c',
    },
  },
  {
    name: 'the right digest in capitals',
    headers: {
      'x-hub-signature-256':
        'sha256=EC1E713BC814A55312BBD566139D9CC02FE90349BD00597A95EF32946AF1BD7C',
    },
  },
  { name: 'an empty signature', headers: { 'x-hub-signature-256': '' } },
])('it refuses a request with $name with HTTP 401', async (row) => {
  const webhook = buildStubGitHubWebhook({
    secret: 'harbour-webhook-secret',
    stream: toTagged<StreamName>('facts.github.pull_request'),
  });

  const received = await webhook.receive(
    new Request('http://pepys.test/webhooks/github', {
      method: 'POST',
      headers: { 'x-github-delivery': 'delivery-7', ...row.headers },
      body: '{"action":"review_requested","pull_request":{"id":12,"title":"Add the harbour map and tides"},"requested_reviewer":{"id":4401}}',
    }),
  );

  expect(received).toStrictEqual({ kind: 'refused', status: 401, reason: 'bad signature' });
});

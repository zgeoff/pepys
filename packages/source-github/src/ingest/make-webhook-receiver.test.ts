import { expect, onTestFinished, spyOn, test } from 'bun:test';
import { Webhooks } from '@octokit/webhooks';
import type { FactEnvelope } from '@pepys/schema';
import { makeWebhookReceiver } from './make-webhook-receiver.ts';

function setupTest(options: { failAppend?: boolean } = {}) {
  const secret = 'fixture-webhook-secret';
  const appended: FactEnvelope<unknown>[] = [];

  const signer = new Webhooks({ secret });

  const receive = makeWebhookReceiver({
    secret,
    appendFact: (fact) => {
      if (options.failAppend === true) {
        return Promise.reject(new Error('s2 is down'));
      }

      appended.push(fact);

      return Promise.resolve();
    },
  });

  return { appended, receive, sign: (body: string) => signer.sign(body) };
}

test('it appends the fact of a signed pull request delivery', async () => {
  const ctx = setupTest();

  const body = {
    action: 'opened',
    pull_request: { id: 77, updated_at: '2026-10-02T10:30:00Z' },
    sender: { id: 4401 },
  };

  const text = JSON.stringify(body);

  const response = await ctx.receive(
    new Request('http://ingest.test/webhook', {
      method: 'POST',
      headers: {
        'x-hub-signature-256': await ctx.sign(text),
        'x-github-event': 'pull_request',
        'x-github-delivery': 'd-7',
      },
      body: text,
    }),
  );

  const actual: unknown = { status: response.status, appended: ctx.appended };

  expect(actual).toStrictEqual({
    status: 202,
    appended: [
      {
        id: 'webhook:github:d-7',
        type: 'github.pull_request.opened',
        v: 1,
        api: 'github/2022-11-28',
        entity: 'github:pr:77',
        actor: 'github:user:4401',
        at: '2026-10-02T10:30:00Z',
        payload: body,
      },
    ],
  });
});

test('it rejects an unsigned request without appending', async () => {
  const ctx = setupTest();

  const response = await ctx.receive(
    new Request('http://ingest.test/webhook', {
      method: 'POST',
      headers: { 'x-github-event': 'pull_request', 'x-github-delivery': 'd-8' },
      body: JSON.stringify({
        action: 'opened',
        pull_request: { id: 1, updated_at: '2026-10-02T10:30:00Z' },
      }),
    }),
  );

  const actual: unknown = { status: response.status, appended: ctx.appended };

  expect(actual).toStrictEqual({
    status: 401,
    appended: [],
  });
});

test('it rejects a request signed with another secret', async () => {
  const ctx = setupTest();

  const text = JSON.stringify({
    action: 'opened',
    pull_request: { id: 1, updated_at: '2026-10-02T10:30:00Z' },
  });

  const forged = await new Webhooks({ secret: 'some-other-secret' }).sign(text);

  const response = await ctx.receive(
    new Request('http://ingest.test/webhook', {
      method: 'POST',
      headers: {
        'x-hub-signature-256': forged,
        'x-github-event': 'pull_request',
        'x-github-delivery': 'd-9',
      },
      body: text,
    }),
  );

  const actual: unknown = { status: response.status, appended: ctx.appended };

  expect(actual).toStrictEqual({
    status: 401,
    appended: [],
  });
});

test('it rejects a body that was changed after it was signed', async () => {
  const ctx = setupTest();

  const signature = await ctx.sign(
    JSON.stringify({
      action: 'opened',
      pull_request: { id: 1, updated_at: '2026-10-02T10:30:00Z' },
    }),
  );

  const response = await ctx.receive(
    new Request('http://ingest.test/webhook', {
      method: 'POST',
      headers: {
        'x-hub-signature-256': signature,
        'x-github-event': 'pull_request',
        'x-github-delivery': 'd-10',
      },
      body: JSON.stringify({
        action: 'opened',
        pull_request: { id: 2, updated_at: '2026-10-02T10:30:00Z' },
      }),
    }),
  );

  const actual: unknown = { status: response.status, appended: ctx.appended };

  expect(actual).toStrictEqual({
    status: 401,
    appended: [],
  });
});

test('it rejects a signature that is not hexadecimal', async () => {
  const ctx = setupTest();

  const response = await ctx.receive(
    new Request('http://ingest.test/webhook', {
      method: 'POST',
      headers: {
        'x-hub-signature-256': 'sha256=not-hex-at-all',
        'x-github-event': 'pull_request',
        'x-github-delivery': 'd-11',
      },
      body: '{}',
    }),
  );

  const actual: unknown = { status: response.status, appended: ctx.appended };

  expect(actual).toStrictEqual({
    status: 401,
    appended: [],
  });
});

test('it acknowledges and drops a signed event that is not a pull request', async () => {
  const ctx = setupTest();
  const text = JSON.stringify({ zen: 'Design for failure.', hook_id: 31 });

  const response = await ctx.receive(
    new Request('http://ingest.test/webhook', {
      method: 'POST',
      headers: {
        'x-hub-signature-256': await ctx.sign(text),
        'x-github-event': 'ping',
        'x-github-delivery': 'd-12',
      },
      body: text,
    }),
  );

  const actual: unknown = { status: response.status, appended: ctx.appended };

  expect(actual).toStrictEqual({
    status: 202,
    appended: [],
  });
});

test('it rejects a signed pull request delivery without a delivery ID', async () => {
  const ctx = setupTest();

  const text = JSON.stringify({
    action: 'opened',
    pull_request: { id: 1, updated_at: '2026-10-02T10:30:00Z' },
  });

  const response = await ctx.receive(
    new Request('http://ingest.test/webhook', {
      method: 'POST',
      headers: { 'x-hub-signature-256': await ctx.sign(text), 'x-github-event': 'pull_request' },
      body: text,
    }),
  );

  const actual: unknown = { status: response.status, appended: ctx.appended };

  expect(actual).toStrictEqual({
    status: 400,
    appended: [],
  });
});

test('it rejects a signed pull request delivery whose body is not JSON', async () => {
  const ctx = setupTest();

  const response = await ctx.receive(
    new Request('http://ingest.test/webhook', {
      method: 'POST',
      headers: {
        'x-hub-signature-256': await ctx.sign('not json'),
        'x-github-event': 'pull_request',
        'x-github-delivery': 'd-13',
      },
      body: 'not json',
    }),
  );

  const actual: unknown = { status: response.status, appended: ctx.appended };

  expect(actual).toStrictEqual({
    status: 400,
    appended: [],
  });
});

test('it rejects a signed pull request delivery that carries no pull request', async () => {
  const ctx = setupTest();
  const text = JSON.stringify({ action: 'opened' });

  const response = await ctx.receive(
    new Request('http://ingest.test/webhook', {
      method: 'POST',
      headers: {
        'x-hub-signature-256': await ctx.sign(text),
        'x-github-event': 'pull_request',
        'x-github-delivery': 'd-14',
      },
      body: text,
    }),
  );

  const actual: unknown = { status: response.status, appended: ctx.appended };

  expect(actual).toStrictEqual({
    status: 422,
    appended: [],
  });
});

test('it answers 502 when the fact cannot be appended', async () => {
  const ctx = setupTest({ failAppend: true });
  const consoleError = spyOn(console, 'error').mockImplementation(() => {});

  onTestFinished(() => {
    consoleError.mockRestore();
  });

  const text = JSON.stringify({
    action: 'opened',
    pull_request: { id: 1, updated_at: '2026-10-02T10:30:00Z' },
  });

  const response = await ctx.receive(
    new Request('http://ingest.test/webhook', {
      method: 'POST',
      headers: {
        'x-hub-signature-256': await ctx.sign(text),
        'x-github-event': 'pull_request',
        'x-github-delivery': 'd-15',
      },
      body: text,
    }),
  );

  expect(response.status).toBe(502);
});

test('it refuses a request that is not a POST', async () => {
  const ctx = setupTest();

  const response = await ctx.receive(new Request('http://ingest.test/webhook', { method: 'GET' }));

  expect(response.status).toBe(405);
});

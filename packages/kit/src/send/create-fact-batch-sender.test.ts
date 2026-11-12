import { expect, mock, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { HttpResponse, http } from 'msw';
import invariant from 'tiny-invariant';
import { z } from 'zod';
import { defineFactFamily } from '../sources/define-fact-family.ts';
import { defineSource } from '../sources/define-source.ts';
import { receiveFactBatch } from '../sources/receive-fact-batch.ts';
import { mockNetwork } from '../test-utils/mock-network.ts';
import { createFactBatchSender } from './create-fact-batch-sender.ts';

function setupTest() {
  const family = defineFactFamily({
    stream: 'facts.ledger.entry',
    api: 'ledger/1',
    entityKind: 'ledger:entry',
    types: { 'ledger.entry.posted': z.object({ cents: z.number() }) },
  });

  const source = defineSource({
    name: 'ledger',
    families: [family],
    live: receiveFactBatch({
      route: '/ledger/facts',
      check: {
        kind: 'hmac-sha256',
        header: 'x-ledger-signature-256',
        secretEnv: 'LEDGER_SIGNING_SECRET',
      },
      factLimit: 2,
    }),
  });

  return { source };
}

test('it posts the batch as JSON to the URL it was given', async () => {
  const ctx = setupTest();
  const received = mock<(request: Record<string, unknown>) => void>();

  mockNetwork.use(
    http.post('https://ingest.example/ledger/facts', async (info) => {
      received({
        method: info.request.method,
        contentType: info.request.headers.get('content-type'),
        body: await info.request.json(),
      });

      return HttpResponse.json({ status: 'stored', stored: 2 });
    }),
  );

  const send = createFactBatchSender({
    source: ctx.source,
    url: 'https://ingest.example/ledger/facts',
    secret: 'tide-table',
  });

  const sent = await send([
    {
      type: 'ledger.entry.posted',
      event: 'e-1',
      entity: 'ledger:entry:1',
      at: '2026-11-01T08:00:00.000Z',
      payload: { cents: 1200 },
    },
    {
      type: 'ledger.entry.posted',
      event: 'e-2',
      entity: 'ledger:entry:2',
      at: '2026-11-01T08:01:00.000Z',
      payload: { cents: 80 },
    },
  ]);

  expect(sent).toStrictEqual({ ok: true, value: { stored: 2 } });

  expect(received).toHaveBeenCalledExactlyOnceWith({
    method: 'POST',
    contentType: 'application/json',
    body: {
      v: 1,
      facts: [
        {
          type: 'ledger.entry.posted',
          event: 'e-1',
          entity: 'ledger:entry:1',
          at: '2026-11-01T08:00:00.000Z',
          payload: { cents: 1200 },
        },
        {
          type: 'ledger.entry.posted',
          event: 'e-2',
          entity: 'ledger:entry:2',
          at: '2026-11-01T08:01:00.000Z',
          payload: { cents: 80 },
        },
      ],
    },
  });
});

test('it signs the bytes it sends with the secret, in the header of the path', async () => {
  const ctx = setupTest();
  const sentProofs: { header: string | null; body: string }[] = [];

  mockNetwork.use(
    http.post('https://ingest.example/ledger/facts', async (info) => {
      sentProofs.push({
        header: info.request.headers.get('x-ledger-signature-256'),
        body: await info.request.text(),
      });

      return HttpResponse.json({ status: 'stored', stored: 1 });
    }),
  );

  const send = createFactBatchSender({
    source: ctx.source,
    url: 'https://ingest.example/ledger/facts',
    secret: 'tide-table',
  });

  await send([
    {
      type: 'ledger.entry.posted',
      event: 'e-1',
      entity: 'ledger:entry:1',
      at: '2026-11-01T08:00:00.000Z',
      payload: { cents: 1200 },
    },
  ]);

  const [proof] = sentProofs;

  invariant(proof !== undefined, 'the sender made one request');

  expect(proof.header).toBe(
    `sha256=${createHmac('sha256', 'tide-table').update(proof.body).digest('hex')}`,
  );
});

test.each([502, 503, 504])('it reads a %d answer as a retry', async (status) => {
  const ctx = setupTest();

  mockNetwork.use(
    http.post(
      'https://ingest.example/ledger/facts',
      () => new HttpResponse('log unavailable', { status }),
    ),
  );

  const send = createFactBatchSender({
    source: ctx.source,
    url: 'https://ingest.example/ledger/facts',
    secret: 'tide-table',
  });

  const sent = await send([
    {
      type: 'ledger.entry.posted',
      event: 'e-1',
      entity: 'ledger:entry:1',
      at: '2026-11-01T08:00:00.000Z',
      payload: { cents: 1200 },
    },
  ]);

  expect(sent).toStrictEqual({
    ok: false,
    failure: { kind: 'retry', reason: `ingest answered ${status}: log unavailable` },
  });
});

test.each([400, 401, 413, 422, 500])('it reads a %d answer as a refusal', async (status) => {
  const ctx = setupTest();

  mockNetwork.use(
    http.post('https://ingest.example/ledger/facts', () => new HttpResponse('no', { status })),
  );

  const send = createFactBatchSender({
    source: ctx.source,
    url: 'https://ingest.example/ledger/facts',
    secret: 'tide-table',
  });

  const sent = await send([
    {
      type: 'ledger.entry.posted',
      event: 'e-1',
      entity: 'ledger:entry:1',
      at: '2026-11-01T08:00:00.000Z',
      payload: { cents: 1200 },
    },
  ]);

  expect(sent).toStrictEqual({ ok: false, failure: { kind: 'refused', status, reason: 'no' } });
});

test('it reads a redirect as a refusal, and never follows it', async () => {
  const ctx = setupTest();
  const followed = mock<() => void>();

  mockNetwork.use(
    http.post(
      'https://ingest.example/ledger/facts',
      () =>
        new HttpResponse('moved', {
          status: 302,
          headers: { location: 'https://ingest.example/elsewhere' },
        }),
    ),
    http.all('https://ingest.example/elsewhere', () => {
      followed();

      return HttpResponse.json({ status: 'stored', stored: 1 });
    }),
  );

  const send = createFactBatchSender({
    source: ctx.source,
    url: 'https://ingest.example/ledger/facts',
    secret: 'tide-table',
  });

  const sent = await send([
    {
      type: 'ledger.entry.posted',
      event: 'e-1',
      entity: 'ledger:entry:1',
      at: '2026-11-01T08:00:00.000Z',
      payload: { cents: 1200 },
    },
  ]);

  expect({ sent, followed: followed.mock.calls.length }).toStrictEqual({
    sent: { ok: false, failure: { kind: 'refused', status: 302, reason: 'moved' } },
    followed: 0,
  });
});

test('it reads an ignored batch as none stored', async () => {
  const ctx = setupTest();

  mockNetwork.use(
    http.post('https://ingest.example/ledger/facts', () =>
      HttpResponse.json({ status: 'ignored' }, { status: 202 }),
    ),
  );

  const send = createFactBatchSender({
    source: ctx.source,
    url: 'https://ingest.example/ledger/facts',
    secret: 'tide-table',
  });

  const sent = await send([
    {
      type: 'ledger.entry.posted',
      event: 'e-1',
      entity: 'ledger:entry:1',
      at: '2026-11-01T08:00:00.000Z',
      payload: { cents: 1200 },
    },
  ]);

  expect(sent).toStrictEqual({ ok: true, value: { stored: 0 } });
});

test('it reads a success with no count as a retry', async () => {
  const ctx = setupTest();

  mockNetwork.use(
    http.post('https://ingest.example/ledger/facts', () => new HttpResponse('ok', { status: 200 })),
  );

  const send = createFactBatchSender({
    source: ctx.source,
    url: 'https://ingest.example/ledger/facts',
    secret: 'tide-table',
  });

  const sent = await send([
    {
      type: 'ledger.entry.posted',
      event: 'e-1',
      entity: 'ledger:entry:1',
      at: '2026-11-01T08:00:00.000Z',
      payload: { cents: 1200 },
    },
  ]);

  expect(sent).toStrictEqual({
    ok: false,
    failure: { kind: 'retry', reason: 'ingest answered 200: ok' },
  });
});

test('it reads a transport failure as a retry', async () => {
  const ctx = setupTest();

  mockNetwork.use(http.post('https://ingest.example/ledger/facts', () => HttpResponse.error()));

  const send = createFactBatchSender({
    source: ctx.source,
    url: 'https://ingest.example/ledger/facts',
    secret: 'tide-table',
  });

  const sent = await send([
    {
      type: 'ledger.entry.posted',
      event: 'e-1',
      entity: 'ledger:entry:1',
      at: '2026-11-01T08:00:00.000Z',
      payload: { cents: 1200 },
    },
  ]);

  expect(sent).toStrictEqual({
    ok: false,
    failure: { kind: 'retry', reason: expect.any(String) },
  });
});

test('it reads no connection as a retry', async () => {
  const ctx = setupTest();

  const send = createFactBatchSender({
    source: ctx.source,
    url: 'http://127.0.0.1:1/ledger/facts',
    secret: 'tide-table',
  });

  const sent = await send([
    {
      type: 'ledger.entry.posted',
      event: 'e-1',
      entity: 'ledger:entry:1',
      at: '2026-11-01T08:00:00.000Z',
      payload: { cents: 1200 },
    },
  ]);

  expect(sent).toStrictEqual({
    ok: false,
    failure: { kind: 'retry', reason: expect.any(String) },
  });
});

test('it refuses a batch over the fact limit of the path without a request', async () => {
  const ctx = setupTest();
  const received = mock<() => void>();

  mockNetwork.use(
    http.post('https://ingest.example/ledger/facts', () => {
      received();

      return HttpResponse.json({ status: 'stored', stored: 3 });
    }),
  );

  const send = createFactBatchSender({
    source: ctx.source,
    url: 'https://ingest.example/ledger/facts',
    secret: 'tide-table',
  });

  const fact = {
    type: 'ledger.entry.posted',
    event: 'e-1',
    entity: 'ledger:entry:1',
    at: '2026-11-01T08:00:00.000Z',
    payload: { cents: 1200 },
  } as const;

  const sent = await send([fact, fact, fact]);

  expect({ sent, requests: received.mock.calls.length }).toStrictEqual({
    sent: {
      ok: false,
      failure: {
        kind: 'refused',
        status: 413,
        reason: "3 facts is over the path's limit of 2",
      },
    },
    requests: 0,
  });
});

test('it will not make a sender with an empty secret', () => {
  const ctx = setupTest();

  expect(() =>
    createFactBatchSender({ source: ctx.source, url: 'https://ingest.example', secret: '' }),
  ).toThrow('the secret for the source ledger is empty');
});

test('it will not make a sender for a source with no receive path', () => {
  const source = defineSource({ name: 'ledger', families: [] });

  expect(() =>
    createFactBatchSender({ source, url: 'https://ingest.example', secret: 'tide-table' }),
  ).toThrow('the source ledger has no receive path to send to');
});

test('it imports nothing at run time that the kit does not depend on', async () => {
  const manifest: unknown = await Bun.file(new URL('../../package.json', import.meta.url)).json();

  const dependencies = z.object({ dependencies: z.record(z.string(), z.string()) }).parse(manifest);

  const bundle = await Bun.build({
    entrypoints: [new URL('../send.ts', import.meta.url).pathname],
    target: 'node',
    packages: 'external',
  });

  const text = await bundle.outputs[0]?.text();

  const imported = [...(text ?? '').matchAll(/from\s+"(?<name>[^".][^"]*)"/gu)].map(
    (found) => found.groups?.['name'] ?? '',
  );

  expect(imported).toContain('zod');

  expect(imported).toSatisfyAll(
    (name: string) => name.startsWith('node:') || Object.hasOwn(dependencies.dependencies, name),
  );
});

import { expect, test } from 'bun:test';
import { z } from 'zod';
import { isDeliveryAuthentic } from '../delivery-checks/is-delivery-authentic.ts';
import { defineFactFamily } from '../sources/define-fact-family.ts';
import { defineSource } from '../sources/define-source.ts';
import { receiveFactBatch } from '../sources/receive-fact-batch.ts';
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

  const requests: Request[] = [];

  return {
    source,
    requests,

    // A stand-in for ingest's route: the same check and the same read, then a status answer.
    receive: async (request: Request): Promise<Response> => {
      requests.push(request);

      const path = source.live;

      const bytes = await request.arrayBuffer();

      const body = new Uint8Array(bytes);

      if (path?.kind !== 'receive') {
        return new Response(null, { status: 500 });
      }

      if (!isDeliveryAuthentic(path.check, 'tide-table', request.headers, body)) {
        return new Response(null, { status: 401 });
      }

      const received = path.read({ headers: request.headers, body }, source);

      if (received.kind !== 'batch') {
        return new Response(null, { status: 422 });
      }

      return Response.json({ status: 'stored', stored: received.batch.facts.length });
    },

    // An ingest that gives every request the same answer.
    makeAnswer: (status: number, text: string) => (): Promise<Response> =>
      Promise.resolve(new Response(text, { status })),
  };
}

test('it signs a batch that passes the check and the read of the receive path', async () => {
  const ctx = setupTest();

  const send = createFactBatchSender({
    source: ctx.source,
    url: 'https://ingest.example/ledger/facts',
    secret: 'tide-table',
    fetch: ctx.receive,
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
});

test('it refuses a batch with a wrong secret at the receive path', async () => {
  const ctx = setupTest();

  const send = createFactBatchSender({
    source: ctx.source,
    url: 'https://ingest.example/ledger/facts',
    secret: 'neap-tide',
    fetch: ctx.receive,
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

  expect(sent).toStrictEqual({ ok: false, failure: { kind: 'refused', status: 401, reason: '' } });
});

test.each([502, 503, 504])('it reads a %d answer as a retry', async (status) => {
  const ctx = setupTest();

  const send = createFactBatchSender({
    source: ctx.source,
    url: 'https://ingest.example/ledger/facts',
    secret: 'tide-table',
    fetch: ctx.makeAnswer(status, 'log unavailable'),
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

test.each([400, 401, 413, 422, 302, 500])('it reads a %d answer as a refusal', async (status) => {
  const ctx = setupTest();

  const send = createFactBatchSender({
    source: ctx.source,
    url: 'https://ingest.example/ledger/facts',
    secret: 'tide-table',
    fetch: ctx.makeAnswer(status, 'no'),
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

test('it reads an ignored batch as none stored', async () => {
  const ctx = setupTest();

  const send = createFactBatchSender({
    source: ctx.source,
    url: 'https://ingest.example/ledger/facts',
    secret: 'tide-table',
    fetch: ctx.makeAnswer(202, '{"status":"ignored"}'),
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

  const send = createFactBatchSender({
    source: ctx.source,
    url: 'https://ingest.example/ledger/facts',
    secret: 'tide-table',
    fetch: ctx.makeAnswer(200, 'ok'),
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

  const send = createFactBatchSender({
    source: ctx.source,
    url: 'https://ingest.example/ledger/facts',
    secret: 'tide-table',
    fetch: ctx.receive,
  });

  const fact = {
    type: 'ledger.entry.posted',
    event: 'e-1',
    entity: 'ledger:entry:1',
    at: '2026-11-01T08:00:00.000Z',
    payload: { cents: 1200 },
  } as const;

  const sent = await send([fact, fact, fact]);

  expect([sent, ctx.requests.length]).toStrictEqual([
    {
      ok: false,
      failure: {
        kind: 'refused',
        status: 413,
        reason: "3 facts is over the path's limit of 2",
      },
    },
    0,
  ]);
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

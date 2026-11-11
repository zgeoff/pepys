import { expect, onTestFinished, spyOn, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import type { EntityID, StreamName, StreamOffset } from '@pepys/kit';
import { createFactBatchSender } from '@pepys/kit/send';
import { toTagged } from '@zgeoff/std';
import invariant from 'tiny-invariant';
import type { FactLog } from '../fact-log/fact-log.ts';
import { createMemoryFactLog } from '../fact-log/memory/create-memory-fact-log.ts';
import { createFakeSenderProof } from '../sender-proof/fake/create-fake-sender-proof.ts';
import { noSenderProof } from '../sender-proof/none/no-sender-proof.ts';
import { buildStubFactLog } from '../test-utils/build-stub-fact-log.ts';
import { buildStubReceiveDeployment } from '../test-utils/build-stub-receive-deployment.ts';
import { createIngest } from './create-ingest.ts';
import type { IngestOptions } from './create-ingest.ts';

interface LedgerRequest {
  // the body is `text` when given, and otherwise a fact batch of `facts`
  facts?: readonly Record<string, unknown>[];
  text?: string;
  method?: string;

  // the secret that signs, a header value, or 'none'
  signature?: 'valid' | 'other-secret' | 'empty-secret' | 'none' | `sha256=${string}`;

  // what the signature covers, when it is not the body
  signedText?: string;
  headers?: Record<string, string>;
}

interface BeaconRequest {
  route?: string;
  body: string | Uint8Array<ArrayBuffer>;
  token?: string | null;
  identity?: string | null;
  headers?: Record<string, string>;
}

function setupTest() {
  const stub = buildStubReceiveDeployment();
  const streams = stub.streams;
  const clock = { nowMs: 0 };

  const createLog = () =>
    createMemoryFactLog([streams.till, streams.lamp, streams.stray, streams.strayMark]);

  const createIngestOver = (
    overrides: Partial<Pick<IngestOptions, 'log' | 'secrets' | 'senderProof' | 'appendRetry'>>,
  ) =>
    createIngest({
      deployment: stub.deployment,
      secrets: {
        LEDGER_SECRET: 'till-secret',
        BEACON_TOKEN: 'harbour-key',
        STRAY_TOKEN: 'stray-key',
      },
      log: createLog(),
      senderProof: createFakeSenderProof({
        'token-4': { issuer: 'https://id.example', subject: 'worker-4', name: 'worker four' },
        'token-5': { issuer: 'https://id.example', subject: 'worker-5', name: 'worker five' },
      }),
      appendRetry: { maxAttempts: 2, retryDelayMs: 0 },
      now: () => clock.nowMs,
      ...overrides,
    });

  const log = createLog();

  const readStored = async (stream: StreamName, from: FactLog = log) => {
    const read = await from.read(stream, toTagged<StreamOffset>(0), 100);

    invariant(read.ok, 'the stream exists');

    return read.value;
  };

  const secrets: Readonly<Record<string, string>> = {
    valid: 'till-secret',
    'other-secret': 'neap-tide',
    'empty-secret': '',
  };

  return {
    stub,
    streams,
    clock,
    createLog,
    createIngestOver,
    ingest: createIngestOver({ log }),
    readIDs: async (stream: StreamName, from: FactLog = log) => {
      const stored = await readStored(stream, from);

      return stored.map((item): string => item.fact.id);
    },
    readPayloads: async (stream: StreamName) => {
      const stored = await readStored(stream);

      return stored.map((item) => item.fact.payload);
    },
    buildLedgerRequest: (request: LedgerRequest) => {
      const method = request.method ?? 'POST';
      const text = request.text ?? JSON.stringify({ v: 1, facts: request.facts ?? [] });
      const signature = request.signature ?? 'valid';
      const key = secrets[signature];
      const hmac = createHmac('sha256', key ?? '').update(request.signedText ?? text);

      const headers = new Headers(request.headers);

      const header = key === undefined ? signature : `sha256=${hmac.digest('hex')}`;

      if (signature !== 'none') {
        headers.set('x-ledger-signature-256', header);
      }

      return new Request('http://ingest.test/ledger/facts', {
        method,
        headers,
        ...(method === 'GET' ? {} : { body: text }),
      });
    },
    buildBeaconRequest: (request: BeaconRequest) => {
      const headers = new Headers(request.headers);

      const token = request.token === undefined ? 'harbour-key' : request.token;
      const identity = request.identity === undefined ? 'token-4' : request.identity;

      if (token !== null) {
        headers.set('authorization', `Bearer ${token}`);
      }

      if (identity !== null) {
        headers.set('imp-identity', identity);
      }

      return new Request(`http://ingest.test${request.route ?? '/beacon/readings'}`, {
        method: 'POST',
        headers,
        body: request.body,
      });
    },
    readAnswer: async (response: Response) => {
      const body: unknown = await response.json();

      return { status: response.status, body };
    },
  };
}

test('it stores a signed fact batch that comes through its route, and the fact ID reads back', async () => {
  const ctx = setupTest();

  const send = createFactBatchSender({
    source: ctx.stub.ledgerSource,
    url: 'http://ingest.test/ledger/facts',
    secret: 'till-secret',
    fetch: ctx.ingest.handleRequest,
  });

  const sent = await send([
    {
      type: 'ledger.till.opened',
      event: 'evt-0001',
      entity: 'ledger:till:7',
      at: '2026-10-01T08:00:00Z',
      payload: { float: 120 },
    },
  ]);

  const ids = await ctx.readIDs(ctx.streams.till);

  expect({ sent, ids }).toStrictEqual({
    sent: { ok: true, value: { stored: 1 } },
    ids: ['event:ledger:evt-0001'],
  });
});

test('it stores the proven sender as the origin, and never one the body or a header names', async () => {
  const ctx = setupTest();

  const request = ctx.buildBeaconRequest({
    body: JSON.stringify({
      readings: [
        {
          lamp: 'north',
          at: '2026-10-01T08:00:00Z',
          level: 3,
          origin: { issuer: 'https://forged.example', subject: 'worker-9' },
        },
      ],
    }),
    headers: { 'x-origin-subject': 'worker-9' },
  });

  const response = await ctx.ingest.handleRequest(request);
  const answer = await ctx.readAnswer(response);
  const payloads = await ctx.readPayloads(ctx.streams.lamp);

  expect({ answer, payloads }).toStrictEqual({
    answer: { status: 200, body: {} },
    payloads: [{ level: 3, origin: { issuer: 'https://id.example', subject: 'worker-4' } }],
  });
});

test.each([
  { row: 'a method other than POST', request: { method: 'GET' }, status: 405 },
  { row: 'a body over the limit', request: { text: 'x'.repeat(2_200_001) }, status: 413 },
  { row: 'no signature', request: { signature: 'none' }, status: 401 },
  {
    row: 'a signature that is not hex',
    request: { signature: `sha256=${'g'.repeat(64)}` },
    status: 401,
  },
  {
    row: 'a signature made with another secret',
    request: { signature: 'other-secret' },
    status: 401,
  },
  {
    row: 'a body changed after it was signed',
    request: { signedText: '{"v":1,"facts":[{}]}' },
    status: 401,
  },
  {
    row: 'a gzip body on a path that takes none',
    request: { headers: { 'content-encoding': 'gzip' } },
    status: 415,
  },
  { row: 'a body that is not JSON', request: { text: 'not json' }, status: 400 },
  {
    row: 'a body that is not JSON and has no signature',
    request: { text: 'not json', signature: 'none' },
    status: 401,
  },
  {
    row: 'a fact of a type the source does not have',
    request: {
      facts: [
        {
          type: 'ledger.till.lost',
          event: 'e-1',
          entity: 'ledger:till:7',
          at: '2026-10-01T08:00:00Z',
          payload: {},
        },
      ],
    },
    status: 422,
  },
  {
    row: 'a fact whose envelope fails the check',
    request: {
      facts: [
        {
          type: 'ledger.till.opened',
          event: 'e-1',
          entity: 'ledger:till:7',
          at: 'yesterday',
          payload: { float: 1 },
        },
      ],
    },
    status: 422,
  },
  {
    row: 'more facts than the path takes',
    request: {
      facts: [
        {
          type: 'ledger.till.opened',
          event: 'e-1',
          entity: 'ledger:till:7',
          at: '2026-10-01T08:00:00Z',
          payload: { float: 1 },
        },
        {
          type: 'ledger.till.opened',
          event: 'e-2',
          entity: 'ledger:till:7',
          at: '2026-10-01T08:00:00Z',
          payload: { float: 1 },
        },
        {
          type: 'ledger.till.opened',
          event: 'e-3',
          entity: 'ledger:till:7',
          at: '2026-10-01T08:00:00Z',
          payload: { float: 1 },
        },
        {
          type: 'ledger.till.opened',
          event: 'e-4',
          entity: 'ledger:till:7',
          at: '2026-10-01T08:00:00Z',
          payload: { float: 1 },
        },
      ],
    },
    status: 413,
  },
  {
    row: 'a fact larger than one append of the log takes',
    request: {
      facts: [
        {
          type: 'ledger.till.noted',
          event: 'e-1',
          entity: 'ledger:till:7',
          at: '2026-10-01T08:00:00Z',
          payload: { note: 'x'.repeat(1_100_000) },
        },
      ],
    },
    status: 413,
  },
] satisfies { row: string; request: LedgerRequest; status: number }[])(
  'it answers $status and appends nothing to $row',
  async (row) => {
    const ctx = setupTest();

    const response = await ctx.ingest.handleRequest(ctx.buildLedgerRequest(row.request));
    const answer = await ctx.readAnswer(response);
    const ids = await ctx.readIDs(ctx.streams.till);

    expect({ answer, ids }).toStrictEqual({
      answer: { status: row.status, body: { error: expect.any(String) } },
      ids: [],
    });
  },
);

test.each([
  { row: 'no token', request: { body: '{"readings":[]}', token: null }, status: 401 },
  {
    row: 'another token',
    request: { body: '{"readings":[]}', token: 'harbour-lock' },
    status: 401,
  },
  {
    row: 'no identity on a path that needs a sender',
    request: { body: '{"readings":[]}', identity: null },
    status: 401,
  },
  {
    row: 'an identity that proves no sender',
    request: { body: '{"readings":[]}', identity: 'token-9' },
    status: 401,
  },
  {
    row: 'an ignored route with no token',
    request: { route: '/beacon/pings', body: '{}', token: null },
    status: 401,
  },
  {
    row: 'an ignored route with no sender',
    request: { route: '/beacon/pings', body: '{}', identity: null },
    status: 401,
  },
  {
    row: 'an encoding the path does not take',
    request: { body: '{"readings":[]}', headers: { 'content-encoding': 'br' } },
    status: 415,
  },
  {
    row: 'a gzip body that expands past the limit',
    request: {
      body: Bun.gzipSync(new Uint8Array(16 * 1_048_576)),
      headers: { 'content-encoding': 'gzip' },
    },
    status: 413,
  },
  {
    row: 'a gzip body that does not gunzip',
    request: { body: 'not gzip at all', headers: { 'content-encoding': 'gzip' } },
    status: 400,
  },
  { row: 'a body that is no beacon export', request: { body: 'not json' }, status: 400 },
] satisfies { row: string; request: BeaconRequest; status: number }[])(
  'it answers $status and appends nothing to $row',
  async (row) => {
    const ctx = setupTest();

    const response = await ctx.ingest.handleRequest(ctx.buildBeaconRequest(row.request));
    const answer = await ctx.readAnswer(response);
    const ids = await ctx.readIDs(ctx.streams.lamp);

    expect({ answer, ids }).toStrictEqual({
      answer: { status: row.status, body: { error: expect.any(String) } },
      ids: [],
    });
  },
);

test.each([
  {
    row: 'a fact on a stream the source does not own',
    mode: 'foreign-stream',
    token: 'stray-key',
    status: 422,
  },
  {
    row: 'a fact with a blob, which ingest has no store for',
    mode: 'blob',
    token: 'stray-key',
    status: 500,
  },
  { row: 'a read that throws', mode: 'throw', token: 'stray-key', status: 500 },
  {
    row: 'a wrong token, before the read that would throw runs',
    mode: 'throw',
    token: 'stray-lock',
    status: 401,
  },
])('it answers $status and appends nothing to $row', async (row) => {
  const ctx = setupTest();

  const request = new Request('http://ingest.test/stray/notes', {
    method: 'POST',
    headers: { authorization: row.token, 'x-stray-mode': row.mode },
    body: '{}',
  });

  const response = await ctx.ingest.handleRequest(request);
  const answer = await ctx.readAnswer(response);
  const tillIDs = await ctx.readIDs(ctx.streams.till);
  const strayIDs = await ctx.readIDs(ctx.streams.stray);

  expect({ answer, ids: [...tillIDs, ...strayIDs] }).toStrictEqual({
    answer: { status: row.status, body: { error: expect.any(String) } },
    ids: [],
  });
});

test('it refuses every delivery on a route whose secret is empty, one signed with the empty secret included', async () => {
  const ctx = setupTest();
  const log = ctx.createLog();
  const ingest = ctx.createIngestOver({ log, secrets: { LEDGER_SECRET: '' } });

  const request = ctx.buildLedgerRequest({
    facts: [
      {
        type: 'ledger.till.opened',
        event: 'e-1',
        entity: 'ledger:till:7',
        at: '2026-10-01T08:00:00Z',
        payload: { float: 1 },
      },
    ],
    signature: 'empty-secret',
  });

  const response = await ingest.handleRequest(request);
  const answer = await ctx.readAnswer(response);
  const ids = await ctx.readIDs(ctx.streams.till, log);

  expect({ answer, ids }).toStrictEqual({
    answer: { status: 401, body: { error: 'not authorised' } },
    ids: [],
  });
});

test('it refuses every delivery on a path that needs a sender when no adapter proves one', async () => {
  const ctx = setupTest();
  const log = ctx.createLog();
  const ingest = ctx.createIngestOver({ log, senderProof: noSenderProof });

  const request = ctx.buildBeaconRequest({
    body: JSON.stringify({ readings: [{ lamp: 'north', at: '2026-10-01T08:00:00Z', level: 3 }] }),
  });

  const response = await ingest.handleRequest(request);
  const answer = await ctx.readAnswer(response);
  const ids = await ctx.readIDs(ctx.streams.lamp, log);

  expect({ answer, ids }).toStrictEqual({
    answer: { status: 401, body: { error: 'not authorised' } },
    ids: [],
  });
});

test('it refuses with 401 a delivery whose sender proof throws, and stores nothing', async () => {
  const ctx = setupTest();
  const log = ctx.createLog();
  const error = spyOn(console, 'error').mockImplementation(() => {});

  onTestFinished(() => {
    error.mockRestore();
  });

  const ingest = ctx.createIngestOver({
    log,
    senderProof: { prove: () => Promise.reject(new Error('the verifier broke')) },
  });

  const request = ctx.buildBeaconRequest({
    body: JSON.stringify({ readings: [{ lamp: 'north', at: '2026-10-01T08:00:00Z', level: 3 }] }),
  });

  const response = await ingest.handleRequest(request);
  const answer = await ctx.readAnswer(response);
  const ids = await ctx.readIDs(ctx.streams.lamp, log);

  expect({ answer, ids }).toStrictEqual({
    answer: { status: 401, body: { error: 'not authorised' } },
    ids: [],
  });
});

test('it answers 500 when the log refuses one stream of two, and the other stream keeps what it stored', async () => {
  const ctx = setupTest();
  const log = createMemoryFactLog([ctx.streams.stray]);
  const ingest = ctx.createIngestOver({ log });

  const request = new Request('http://ingest.test/stray/notes', {
    method: 'POST',
    headers: { authorization: 'stray-key', 'x-stray-mode': 'two-streams' },
    body: '{}',
  });

  const response = await ingest.handleRequest(request);
  const answer = await ctx.readAnswer(response);
  const ids = await ctx.readIDs(ctx.streams.stray, log);

  expect({ answer, ids }).toStrictEqual({
    answer: { status: 500, body: { error: 'the log refused the batch' } },
    ids: ['event:stray:note-1'],
  });
});

test('it answers 500 when an append throws', async () => {
  const ctx = setupTest();

  const log = {
    ...ctx.createLog(),
    appendBatch: () => Promise.reject(new Error('the access token is not valid')),
  };

  const ingest = ctx.createIngestOver({ log });

  const request = ctx.buildLedgerRequest({
    facts: [
      {
        type: 'ledger.till.opened',
        event: 'e-1',
        entity: 'ledger:till:7',
        at: '2026-10-01T08:00:00Z',
        payload: { float: 1 },
      },
    ],
  });

  const response = await ingest.handleRequest(request);
  const answer = await ctx.readAnswer(response);

  expect(answer).toStrictEqual({ status: 500, body: { error: 'the log refused the batch' } });
});

test('it stores a delivery that got 503 when it is sent again, and never drops it as a repeat', async () => {
  const ctx = setupTest();
  const log = ctx.createLog();
  const ingest = ctx.createIngestOver({ log, appendRetry: { maxAttempts: 1, retryDelayMs: 0 } });

  const facts = [
    {
      type: 'ledger.till.opened',
      event: 'e-1',
      entity: 'ledger:till:7',
      at: '2026-10-01T08:00:00Z',
      payload: { float: 1 },
    },
  ];

  log.dropNextAppend({ thenAppend: [] });

  await ingest.handleRequest(ctx.buildLedgerRequest({ facts }));

  const response = await ingest.handleRequest(ctx.buildLedgerRequest({ facts }));
  const again = await ctx.readAnswer(response);
  const ids = await ctx.readIDs(ctx.streams.till, log);

  expect({ again, ids }).toStrictEqual({
    again: { status: 200, body: { status: 'stored', stored: 1 } },
    ids: ['event:ledger:e-1'],
  });
});

test('it answers 500 when the log refuses for a reason no retry mends', async () => {
  const ctx = setupTest();
  const ingest = ctx.createIngestOver({ log: createMemoryFactLog([]) });

  const request = ctx.buildLedgerRequest({
    facts: [
      {
        type: 'ledger.till.opened',
        event: 'e-1',
        entity: 'ledger:till:7',
        at: '2026-10-01T08:00:00Z',
        payload: { float: 1 },
      },
    ],
  });

  const response = await ingest.handleRequest(request);
  const answer = await ctx.readAnswer(response);

  expect(answer).toStrictEqual({ status: 500, body: { error: 'the log refused the batch' } });
});

test('it answers 503 with retry-after when no append is acknowledged after its tries', async () => {
  const ctx = setupTest();
  const ingest = ctx.createIngestOver({ log: buildStubFactLog({ kind: 'unknown' }) });

  const request = ctx.buildLedgerRequest({
    facts: [
      {
        type: 'ledger.till.opened',
        event: 'e-1',
        entity: 'ledger:till:7',
        at: '2026-10-01T08:00:00Z',
        payload: { float: 1 },
      },
    ],
  });

  const response = await ingest.handleRequest(request);
  const answer = await ctx.readAnswer(response);

  expect({ retryAfter: response.headers.get('retry-after'), answer }).toStrictEqual({
    retryAfter: '1',
    answer: { status: 503, body: { error: 'the batch is not stored, send it again' } },
  });
});

test('it answers a second send of a stored body as the first, and appends nothing', async () => {
  const ctx = setupTest();

  const facts = [
    {
      type: 'ledger.till.opened',
      event: 'e-1',
      entity: 'ledger:till:7',
      at: '2026-10-01T08:00:00Z',
      payload: { float: 1 },
    },
  ];

  await ctx.ingest.handleRequest(ctx.buildLedgerRequest({ facts }));

  const response = await ctx.ingest.handleRequest(ctx.buildLedgerRequest({ facts }));
  const second = await ctx.readAnswer(response);
  const ids = await ctx.readIDs(ctx.streams.till);

  expect({ second, ids }).toStrictEqual({
    second: { status: 200, body: { status: 'stored', stored: 1 } },
    ids: ['event:ledger:e-1'],
  });
});

test('it appends a stored body again once an hour has passed', async () => {
  const ctx = setupTest();

  const facts = [
    {
      type: 'ledger.till.opened',
      event: 'e-1',
      entity: 'ledger:till:7',
      at: '2026-10-01T08:00:00Z',
      payload: { float: 1 },
    },
  ];

  await ctx.ingest.handleRequest(ctx.buildLedgerRequest({ facts }));

  ctx.clock.nowMs = 3_600_000;

  await ctx.ingest.handleRequest(ctx.buildLedgerRequest({ facts }));

  const ids = await ctx.readIDs(ctx.streams.till);

  expect(ids).toStrictEqual(['event:ledger:e-1', 'event:ledger:e-1']);
});

test('it refuses a stored body sent again with a wrong signature', async () => {
  const ctx = setupTest();

  const facts = [
    {
      type: 'ledger.till.opened',
      event: 'e-1',
      entity: 'ledger:till:7',
      at: '2026-10-01T08:00:00Z',
      payload: { float: 1 },
    },
  ];

  await ctx.ingest.handleRequest(ctx.buildLedgerRequest({ facts }));

  const response = await ctx.ingest.handleRequest(
    ctx.buildLedgerRequest({ facts, signature: 'other-secret' }),
  );

  const again = await ctx.readAnswer(response);

  expect(again).toStrictEqual({ status: 401, body: { error: 'not authorised' } });
});

test('it stores one body from two proven senders as two deliveries', async () => {
  const ctx = setupTest();

  const body = JSON.stringify({
    readings: [{ lamp: 'north', at: '2026-10-01T08:00:00Z', level: 3 }],
  });

  await ctx.ingest.handleRequest(ctx.buildBeaconRequest({ body, identity: 'token-4' }));
  await ctx.ingest.handleRequest(ctx.buildBeaconRequest({ body, identity: 'token-5' }));

  const payloads = await ctx.readPayloads(ctx.streams.lamp);

  expect(payloads).toStrictEqual([
    { level: 3, origin: { issuer: 'https://id.example', subject: 'worker-4' } },
    { level: 3, origin: { issuer: 'https://id.example', subject: 'worker-5' } },
  ]);
});

test('it answers a checked delivery on an ignored route and stores nothing', async () => {
  const ctx = setupTest();

  const request = ctx.buildBeaconRequest({
    route: '/beacon/pings',
    body: JSON.stringify({ readings: [{ lamp: 'north', at: '2026-10-01T08:00:00Z', level: 3 }] }),
  });

  const response = await ctx.ingest.handleRequest(request);
  const answer = await ctx.readAnswer(response);
  const ids = await ctx.readIDs(ctx.streams.lamp);

  expect({ answer, ids }).toStrictEqual({ answer: { status: 200, body: {} }, ids: [] });
});

test('it stores a gzip body on a path that takes gzip', async () => {
  const ctx = setupTest();

  const text = JSON.stringify({
    readings: [{ lamp: 'north', at: '2026-10-01T08:00:00Z', level: 3 }],
  });

  const body = Bun.gzipSync(new TextEncoder().encode(text));

  await ctx.ingest.handleRequest(
    ctx.buildBeaconRequest({ body, headers: { 'content-encoding': 'gzip' } }),
  );

  const ids = await ctx.readIDs(ctx.streams.lamp);

  expect(ids).toStrictEqual(['event:beacon:north-2026-10-01T08:00:00Z']);
});

test('it answers 202 to a fact batch with no facts', async () => {
  const ctx = setupTest();

  const response = await ctx.ingest.handleRequest(ctx.buildLedgerRequest({ facts: [] }));
  const answer = await ctx.readAnswer(response);

  expect(answer).toStrictEqual({ status: 202, body: { status: 'ignored' } });
});

test('it answers 404 on a route that no receive path has', async () => {
  const ctx = setupTest();

  const response = await ctx.ingest.handleRequest(
    new Request('http://ingest.test/ledger/other', { method: 'POST', body: '{}' }),
  );

  expect(response.status).toBe(404);
});

test.each([
  {
    row: 'a return to an earlier body',
    events: ['first', 'second', 'first'],
    marks: [{ entity: 'ledger:till:7', locator: undefined }],
  },
  {
    row: 'two bodies with one time',
    events: ['first', 'same-time'],
    marks: [{ entity: 'ledger:till:7', locator: undefined }],
  },
  { row: 'a body sent twice in a row', events: ['first', 'first'], marks: [] },
  { row: 'bodies with new times', events: ['first', 'second'], marks: [] },
])('it marks the entity for the resync pull after $row', async (row) => {
  const ctx = setupTest();

  const times: Readonly<Record<string, string>> = {
    first: '2026-10-01T08:00:00Z',
    second: '2026-10-01T09:00:00Z',
    'same-time': '2026-10-01T08:00:00Z',
  };

  for (const event of row.events) {
    const fact = {
      type: 'ledger.till.opened',
      event,
      entity: 'ledger:till:7',
      at: times[event],
      payload: { float: 1 },
    };

    await ctx.ingest.handleRequest(ctx.buildLedgerRequest({ facts: [fact] }));
  }

  const marks: unknown = ctx.ingest.resyncMarks.list('ledger');

  expect(marks).toStrictEqual(row.marks);
});

test('it keeps no marks for a source with no resync pull', async () => {
  const ctx = setupTest();

  const first = JSON.stringify({
    readings: [{ lamp: 'north', at: '2026-10-01T08:00:00Z', level: 3 }],
  });

  const second = JSON.stringify({
    readings: [{ lamp: 'north', at: '2026-10-01T08:00:00Z', level: 4 }],
  });

  for (const body of [first, second, first]) {
    await ctx.ingest.handleRequest(ctx.buildBeaconRequest({ body }));
  }

  const marks = ctx.ingest.resyncMarks.list('beacon');

  expect(marks).toStrictEqual([]);
});

test('it stores the facts of a resync pull and then removes the marks it was given', async () => {
  const ctx = setupTest();
  const log = createMemoryFactLog([ctx.streams.till]);
  const ingest = ctx.createIngestOver({ log });

  for (const event of ['first', 'tied']) {
    const fact = {
      type: 'ledger.till.opened',
      event,
      entity: 'ledger:till:7',
      at: '2026-10-01T08:00:00Z',
      payload: { float: 1 },
    };

    await ingest.handleRequest(ctx.buildLedgerRequest({ facts: [fact] }));
  }

  const run = await ingest.runPull('ledger', 'resync', null);
  const ids = await ctx.readIDs(ctx.streams.till, log);

  const marks = ingest.resyncMarks.list('ledger');

  expect({ run, ids, marks }).toStrictEqual({
    run: { kind: 'stored', stored: 1, cursor: 'resynced', isDone: true },
    ids: ['event:ledger:first', 'event:ledger:tied', 'event:ledger:resynced-ledger:till:7'],
    marks: [],
  });
});

test('it refuses to run a pull that the source does not have', async () => {
  const ctx = setupTest();

  const run = await ctx.ingest.runPull('beacon', 'resync', null);

  expect(run).toStrictEqual({ kind: 'refused', reason: 'the source beacon has no resync pull' });
});

test('it removes a mark once the resync pull removes it', async () => {
  const ctx = setupTest();

  for (const event of ['first', 'tied']) {
    const fact = {
      type: 'ledger.till.opened',
      event,
      entity: 'ledger:till:7',
      at: '2026-10-01T08:00:00Z',
      payload: { float: 1 },
    };

    await ctx.ingest.handleRequest(ctx.buildLedgerRequest({ facts: [fact] }));
  }

  ctx.ingest.resyncMarks.remove('ledger', toTagged<EntityID>('ledger:till:7'));

  const marks = ctx.ingest.resyncMarks.list('ledger');

  expect(marks).toStrictEqual([]);
});

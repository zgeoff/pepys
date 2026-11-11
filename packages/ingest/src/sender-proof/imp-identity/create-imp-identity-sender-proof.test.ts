import { expect, mock, onTestFinished, spyOn, test } from 'bun:test';
import type { StreamOffset } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import invariant from 'tiny-invariant';
import { createMemoryFactLog } from '../../fact-log/memory/create-memory-fact-log.ts';
import { createIngest } from '../../receive/create-ingest.ts';
import { buildStubReceiveDeployment } from '../../test-utils/build-stub-receive-deployment.ts';
import { createImpIdentitySenderProof } from './create-imp-identity-sender-proof.ts';
import type { ImpIdentityTrust, ImpIdentityVerifier } from './types.ts';

interface TrustDocument {
  issuer: string;
}

type Verify = ImpIdentityVerifier<TrustDocument>['verify'];

function setupTest() {
  const stub = buildStubReceiveDeployment();
  const log = createMemoryFactLog([stub.streams.lamp]);

  const logged = [
    spyOn(console, 'error').mockImplementation(() => null),
    spyOn(console, 'warn').mockImplementation(() => null),
    spyOn(console, 'log').mockImplementation(() => null),
  ];

  onTestFinished(() => {
    for (const spy of logged) {
      spy.mockRestore();
    }
  });

  return {
    createIngestWith: (verify: Verify, trust: ImpIdentityTrust<TrustDocument>) =>
      createIngest({
        deployment: stub.deployment,
        secrets: { LEDGER_SECRET: 'till-secret', BEACON_TOKEN: 'tide-key', STRAY_TOKEN: 'stray' },
        log,
        senderProof: createImpIdentitySenderProof({ verify, trust, now: () => 1_794_370_812_400 }),
        appendRetry: { maxAttempts: 1, retryDelayMs: 0 },
        now: () => 0,
      }),
    readLogged: () => logged.flatMap((spy) => spy.mock.calls.flat().map(String)),
    readStoredIDs: async () => {
      const read = await log.read(stub.streams.lamp, toTagged<StreamOffset>(0), 100);

      invariant(read.ok, 'the stream exists');

      return read.value.map((item): string => item.fact.id);
    },
    buildRequest: (route: string, headers: Readonly<Record<string, string>>) =>
      new Request(`http://ingest.test${route}`, {
        method: 'POST',
        headers: { authorization: 'Bearer tide-key', ...headers },
        body: JSON.stringify({
          readings: [{ lamp: 'north', at: '2026-11-11T02:20:00Z', level: 3 }],
        }),
      }),
  };
}

test('it proves the issuer and subject of the verified token, for the audience of the path', async () => {
  const ctx = setupTest();
  const token = 'lamp-head.lamp-body.lamp-seal';

  const verify = mock<Verify>(() =>
    Promise.resolve({ issuer: 'harbour-host', id: 'imp-0193', name: 'tidy-otter' }),
  );

  const ingest = ctx.createIngestWith(verify, {
    issuers: new Map([['BEACON_ISSUERS', [{ issuer: 'harbour-host' }]]]),
    audiences: new Map([['BEACON_AUDIENCE', 'pepys-ingest']]),
  });

  const response = await ingest.handleRequest(
    ctx.buildRequest('/beacon/readings', { 'imp-identity': token }),
  );

  expect({
    status: response.status,
    stored: await ctx.readStoredIDs(),
    verified: verify.mock.calls,
  }).toStrictEqual({
    status: 200,
    stored: ['event:beacon:north-2026-11-11T02:20:00Z'],
    verified: [
      [
        token,
        {
          issuers: [{ issuer: 'harbour-host' }],
          audience: 'pepys-ingest',
          nowSeconds: 1_794_370_812,
        },
      ],
    ],
  });
});

test('it refuses with 401 a token for another audience than the deployment sets', async () => {
  const ctx = setupTest();

  const verify = mock<Verify>((_header, options) => {
    const verified =
      options.audience === 'lantern-ingest'
        ? { issuer: 'harbour-host', id: 'imp-0193', name: 'tidy-otter' }
        : null;

    return Promise.resolve(verified);
  });

  const ingest = ctx.createIngestWith(verify, {
    issuers: new Map([['BEACON_ISSUERS', [{ issuer: 'harbour-host' }]]]),
    audiences: new Map([['BEACON_AUDIENCE', 'pepys-ingest']]),
  });

  const response = await ingest.handleRequest(
    ctx.buildRequest('/beacon/readings', { 'imp-identity': 'aGVhZA.Ym9keQ.c2ln' }),
  );

  expect({
    status: response.status,
    stored: await ctx.readStoredIDs(),
    askedAudiences: verify.mock.calls.map((call) => call[1].audience),
  }).toStrictEqual({ status: 401, stored: [], askedAudiences: ['pepys-ingest'] });
});

test.each([
  { row: 'no identity header', headers: {} },
  { row: 'a header that is no token', headers: { 'imp-identity': 'Bearer let-me-in' } },
  {
    row: 'two joined tokens',
    headers: { 'imp-identity': 'aGVhZA.Ym9keQ.c2ln, aGVhZA.Ym9keQ.c2ln' },
  },
])('it refuses $row with 401, stores nothing and never calls the verifier', async (row) => {
  const ctx = setupTest();

  const verify = mock<Verify>(() =>
    Promise.resolve({ issuer: 'harbour-host', id: 'imp-0193', name: 'tidy-otter' }),
  );

  const ingest = ctx.createIngestWith(verify, {
    issuers: new Map([['BEACON_ISSUERS', [{ issuer: 'harbour-host' }]]]),
    audiences: new Map([['BEACON_AUDIENCE', 'pepys-ingest']]),
  });

  const response = await ingest.handleRequest(ctx.buildRequest('/beacon/readings', row.headers));

  expect({
    status: response.status,
    stored: await ctx.readStoredIDs(),
    verified: verify.mock.calls.length,
  }).toStrictEqual({ status: 401, stored: [], verified: 0 });
});

test('it refuses every delivery with 401 when no trust document is configured', async () => {
  const ctx = setupTest();

  const verify = mock<Verify>(() =>
    Promise.resolve({ issuer: 'harbour-host', id: 'imp-0193', name: 'tidy-otter' }),
  );

  const ingest = ctx.createIngestWith(verify, {
    issuers: new Map(),
    audiences: new Map([['BEACON_AUDIENCE', 'pepys-ingest']]),
  });

  const response = await ingest.handleRequest(
    ctx.buildRequest('/beacon/readings', { 'imp-identity': 'aGVhZA.Ym9keQ.c2ln' }),
  );

  expect({
    status: response.status,
    stored: await ctx.readStoredIDs(),
    verified: verify.mock.calls.length,
  }).toStrictEqual({ status: 401, stored: [], verified: 0 });
});

test('it refuses every delivery with 401 when no audience is configured', async () => {
  const ctx = setupTest();

  const verify = mock<Verify>(() =>
    Promise.resolve({ issuer: 'harbour-host', id: 'imp-0193', name: 'tidy-otter' }),
  );

  const ingest = ctx.createIngestWith(verify, {
    issuers: new Map([['BEACON_ISSUERS', [{ issuer: 'harbour-host' }]]]),
    audiences: new Map(),
  });

  const response = await ingest.handleRequest(
    ctx.buildRequest('/beacon/readings', { 'imp-identity': 'aGVhZA.Ym9keQ.c2ln' }),
  );

  expect({
    status: response.status,
    stored: await ctx.readStoredIDs(),
    verified: verify.mock.calls.length,
  }).toStrictEqual({ status: 401, stored: [], verified: 0 });
});

test('it refuses with 401 a token that the verifier refuses', async () => {
  const ctx = setupTest();

  const ingest = ctx.createIngestWith(() => Promise.resolve(null), {
    issuers: new Map([['BEACON_ISSUERS', [{ issuer: 'harbour-host' }]]]),
    audiences: new Map([['BEACON_AUDIENCE', 'pepys-ingest']]),
  });

  const response = await ingest.handleRequest(
    ctx.buildRequest('/beacon/readings', { 'imp-identity': 'aGVhZA.Ym9keQ.c2ln' }),
  );

  expect({ status: response.status, stored: await ctx.readStoredIDs() }).toStrictEqual({
    status: 401,
    stored: [],
  });
});

test('it refuses with 401 when the verifier throws, and logs no token', async () => {
  const ctx = setupTest();

  const ingest = ctx.createIngestWith(
    (header) => Promise.reject(new Error(`no key for ${header ?? ''}`)),
    {
      issuers: new Map([['BEACON_ISSUERS', [{ issuer: 'harbour-host' }]]]),
      audiences: new Map([['BEACON_AUDIENCE', 'pepys-ingest']]),
    },
  );

  const response = await ingest.handleRequest(
    ctx.buildRequest('/beacon/readings', { 'imp-identity': 'aGVhZA.Ym9keQ.c2ln' }),
  );

  expect({
    status: response.status,
    stored: await ctx.readStoredIDs(),
    logged: ctx.readLogged().filter((line) => line.includes('aGVhZA')),
  }).toStrictEqual({ status: 401, stored: [], logged: [] });
});

test.each([
  { row: 'no subject', verified: { issuer: 'harbour-host', id: '', name: 'tidy-otter' } },
  { row: 'no issuer', verified: { issuer: '', id: 'imp-0193', name: 'tidy-otter' } },
])('it refuses with 401 a verified token with $row', async (row) => {
  const ctx = setupTest();

  const ingest = ctx.createIngestWith(() => Promise.resolve(row.verified), {
    issuers: new Map([['BEACON_ISSUERS', [{ issuer: 'harbour-host' }]]]),
    audiences: new Map([['BEACON_AUDIENCE', 'pepys-ingest']]),
  });

  const response = await ingest.handleRequest(
    ctx.buildRequest('/beacon/readings', { 'imp-identity': 'aGVhZA.Ym9keQ.c2ln' }),
  );

  expect({ status: response.status, stored: await ctx.readStoredIDs() }).toStrictEqual({
    status: 401,
    stored: [],
  });
});

test('it refuses the ignored route with 401 when the verifier refuses the token', async () => {
  const ctx = setupTest();

  const ingest = ctx.createIngestWith(() => Promise.resolve(null), {
    issuers: new Map([['BEACON_ISSUERS', [{ issuer: 'harbour-host' }]]]),
    audiences: new Map([['BEACON_AUDIENCE', 'pepys-ingest']]),
  });

  const response = await ingest.handleRequest(
    ctx.buildRequest('/beacon/pings', { 'imp-identity': 'aGVhZA.Ym9keQ.c2ln' }),
  );

  expect({ status: response.status, stored: await ctx.readStoredIDs() }).toStrictEqual({
    status: 401,
    stored: [],
  });
});

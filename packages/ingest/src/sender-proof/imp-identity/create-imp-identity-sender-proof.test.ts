import { expect, mock, test } from 'bun:test';
import { verifyImpIdentity } from '@impz/client/identity';
import { createTestIdentityIssuer } from '@impz/testing/identity';
import { createLogger } from '@pepys/kit';
import type { StreamOffset } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import invariant from 'tiny-invariant';
import { createMemoryFactLog } from '../../fact-log/memory/create-memory-fact-log.ts';
import { createIngest } from '../../receive/create-ingest.ts';
import { buildStubReceiveDeployment } from '../../test-utils/build-stub-receive-deployment.ts';
import { createImpIdentitySenderProof } from './create-imp-identity-sender-proof.ts';
import type { ImpIdentityTrust } from './types.ts';

type Verify = typeof verifyImpIdentity;

function setupTest() {
  const stub = buildStubReceiveDeployment();
  const log = createMemoryFactLog([stub.streams.lamp]);
  const lines: string[] = [];
  const logger = createLogger({ write: (line) => lines.push(line) });

  const base = {
    createIngestWith: (verify: Verify, trust: ImpIdentityTrust) =>
      createIngest({
        deployment: stub.deployment,
        secrets: { LEDGER_SECRET: 'till-secret', BEACON_TOKEN: 'tide-key', STRAY_TOKEN: 'stray' },
        log,
        senderProof: createImpIdentitySenderProof({
          verify,
          trust,
          now: () => 1_794_370_812_400,
          logger,
        }),
        appendRetry: { maxAttempts: 1, retryDelayMs: 0 },
        now: () => 0,
        logger,
      }),
    readLogged: () => lines.map((line): unknown => JSON.parse(line)),
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
    buildSenderRouteRequest: (headers: Readonly<Record<string, string>>, body?: string) =>
      new Request('http://ingest.test/beacon/forwarded', {
        method: 'POST',
        headers,
        body:
          body ??
          JSON.stringify({ readings: [{ lamp: 'north', at: '2026-11-11T02:20:00Z', level: 3 }] }),
      }),
    readStoredPayloads: async () => {
      const read = await log.read(stub.streams.lamp, toTagged<StreamOffset>(0), 100);

      invariant(read.ok, 'the stream exists');

      return read.value.map((item): unknown => item.fact.payload);
    },
  };

  return {
    ...base,
    setupGroups: async () => {
      const imps = await createTestIdentityIssuer({ issuer: 'harbour-host' });
      const forwarders = await createTestIdentityIssuer({ issuer: 'study-pc' });

      const nowSeconds = 1_794_370_812;

      const trust: ImpIdentityTrust = {
        issuers: new Map([
          ['BEACON_ISSUERS', [imps.document]],
          ['BEACON_FORWARDER_ISSUERS', [forwarders.document]],
        ]),
        audiences: new Map([
          ['BEACON_AUDIENCE', 'pepys-ingest'],
          ['BEACON_FORWARDER_AUDIENCE', 'pepys-forwarders'],
        ]),
      };

      const sign = (issuer: typeof imps, audience: string) =>
        issuer.signToken({
          audience,
          id: 'machine-1',
          name: 'study',
          iat: nowSeconds,
          exp: nowSeconds + 55,
        });

      return {
        ...base,
        trust,
        forwarderToken: await sign(forwarders, 'pepys-forwarders'),
        impToken: await sign(imps, 'pepys-ingest'),
        ingest: base.createIngestWith(verifyImpIdentity, trust),
      };
    },
  };
}

test('it hands the verifier the header, the documents and audience of the path, and the time', async () => {
  const ctx = setupTest();

  const harbour = await createTestIdentityIssuer({ issuer: 'harbour-host' });

  const token = 'lamp-head.lamp-body.lamp-seal';

  const verify = mock<Verify>(() =>
    Promise.resolve({ issuer: 'harbour-host', id: 'imp-0193', name: 'tidy-otter' }),
  );

  const ingest = ctx.createIngestWith(verify, {
    issuers: new Map([['BEACON_ISSUERS', [harbour.document]]]),
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
      [token, { issuers: [harbour.document], audience: 'pepys-ingest', nowSeconds: 1_794_370_812 }],
    ],
  });
});

test('it refuses every delivery with 401 when no trust document is configured, and never calls the verifier', async () => {
  const ctx = setupTest();

  const verify = mock<Verify>(() =>
    Promise.resolve({ issuer: 'harbour-host', id: 'imp-0193', name: 'tidy-otter' }),
  );

  const ingest = ctx.createIngestWith(verify, {
    issuers: new Map([['BEACON_ISSUERS', []]]),
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

test('it refuses every delivery with 401 when no audience is configured, and never calls the verifier', async () => {
  const ctx = setupTest();

  const harbour = await createTestIdentityIssuer({ issuer: 'harbour-host' });

  const verify = mock<Verify>(() =>
    Promise.resolve({ issuer: 'harbour-host', id: 'imp-0193', name: 'tidy-otter' }),
  );

  const ingest = ctx.createIngestWith(verify, {
    issuers: new Map([['BEACON_ISSUERS', [harbour.document]]]),
    audiences: new Map<string, string>(),
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

test('it refuses with 401 when the verifier throws, and logs no token', async () => {
  const ctx = setupTest();

  const harbour = await createTestIdentityIssuer({ issuer: 'harbour-host' });

  const ingest = ctx.createIngestWith(
    (header) => Promise.reject(new Error(`no key for ${header ?? ''}`)),
    {
      issuers: new Map([['BEACON_ISSUERS', [harbour.document]]]),
      audiences: new Map([['BEACON_AUDIENCE', 'pepys-ingest']]),
    },
  );

  const response = await ingest.handleRequest(
    ctx.buildRequest('/beacon/readings', { 'imp-identity': 'aGVhZA.Ym9keQ.c2ln' }),
  );

  expect({
    status: response.status,
    stored: await ctx.readStoredIDs(),
    logged: ctx.readLogged(),
  }).toStrictEqual({
    status: 401,
    stored: [],
    logged: [
      { level: 'error', message: 'the identity verifier failed, so the delivery proves no sender' },
    ],
  });
});

test('it refuses the ignored route with 401 when the verifier refuses the token', async () => {
  const ctx = setupTest();

  const harbour = await createTestIdentityIssuer({ issuer: 'harbour-host' });

  const ingest = ctx.createIngestWith(() => Promise.resolve(null), {
    issuers: new Map([['BEACON_ISSUERS', [harbour.document]]]),
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

test('it stores an export on a sender route with no shared token, and the origin is the token issuer and subject', async () => {
  const ctx = await setupTest().setupGroups();

  const response = await ctx.ingest.handleRequest(
    ctx.buildSenderRouteRequest({ 'imp-identity': ctx.forwarderToken }),
  );

  expect({ status: response.status, payloads: await ctx.readStoredPayloads() }).toStrictEqual({
    status: 200,
    payloads: [{ level: 3, origin: { issuer: 'study-pc', subject: 'machine-1' } }],
  });
});

test('it answers 401 on a sender route to a request with no identity token', async () => {
  const ctx = await setupTest().setupGroups();
  const response = await ctx.ingest.handleRequest(ctx.buildSenderRouteRequest({}));

  expect({ status: response.status, stored: await ctx.readStoredIDs() }).toStrictEqual({
    status: 401,
    stored: [],
  });
});

test('it answers 401 on the path route to a forwarder token with the shared token', async () => {
  const ctx = await setupTest().setupGroups();

  const response = await ctx.ingest.handleRequest(
    ctx.buildRequest('/beacon/readings', { 'imp-identity': ctx.forwarderToken }),
  );

  expect({ status: response.status, stored: await ctx.readStoredIDs() }).toStrictEqual({
    status: 401,
    stored: [],
  });
});

test('it answers 401 on a sender route to a token of an issuer in the imps group', async () => {
  const ctx = await setupTest().setupGroups();

  const response = await ctx.ingest.handleRequest(
    ctx.buildSenderRouteRequest({ 'imp-identity': ctx.impToken }),
  );

  expect({ status: response.status, stored: await ctx.readStoredIDs() }).toStrictEqual({
    status: 401,
    stored: [],
  });
});

test.each([
  {
    row: 'no forwarder audience',
    removeFrom: (trust: ImpIdentityTrust) => ({
      ...trust,
      audiences: new Map([['BEACON_AUDIENCE', 'pepys-ingest']]),
    }),
  },
  {
    row: 'no forwarder trust document',
    removeFrom: (trust: ImpIdentityTrust) => ({
      ...trust,
      issuers: new Map([['BEACON_ISSUERS', trust.issuers.get('BEACON_ISSUERS') ?? []]]),
    }),
  },
])(
  'it answers 401 on a sender route with $row, and the path route still stores an imp export',
  async (row) => {
    const ctx = await setupTest().setupGroups();

    const ingest = ctx.createIngestWith(verifyImpIdentity, row.removeFrom(ctx.trust));

    const refused = await ingest.handleRequest(
      ctx.buildSenderRouteRequest({ 'imp-identity': ctx.forwarderToken }),
    );

    const stored = await ingest.handleRequest(
      ctx.buildRequest('/beacon/readings', { 'imp-identity': ctx.impToken }),
    );

    expect({
      refused: refused.status,
      stored: stored.status,
      ids: await ctx.readStoredIDs(),
    }).toStrictEqual({
      refused: 401,
      stored: 200,
      ids: ['event:beacon:north-2026-11-11T02:20:00Z'],
    });
  },
);

test('it answers 413 on a sender route to a body over the limit of the path', async () => {
  const ctx = await setupTest().setupGroups();

  const response = await ctx.ingest.handleRequest(
    ctx.buildSenderRouteRequest({ 'imp-identity': ctx.forwarderToken }, 'x'.repeat(65_537)),
  );

  expect(response.status).toBe(413);
});

test('it appends once when a sender route gets one export twice', async () => {
  const ctx = await setupTest().setupGroups();

  const headers = { 'imp-identity': ctx.forwarderToken };

  await ctx.ingest.handleRequest(ctx.buildSenderRouteRequest(headers));

  const second = await ctx.ingest.handleRequest(ctx.buildSenderRouteRequest(headers));

  expect({ status: second.status, ids: await ctx.readStoredIDs() }).toStrictEqual({
    status: 200,
    ids: ['event:beacon:north-2026-11-11T02:20:00Z'],
  });
});

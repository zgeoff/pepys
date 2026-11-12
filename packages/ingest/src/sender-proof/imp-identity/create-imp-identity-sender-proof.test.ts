import { expect, mock, test } from 'bun:test';
import type { verifyImpIdentity } from '@impz/client/identity';
import { createLogger } from '@pepys/kit';
import type { StreamOffset } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import invariant from 'tiny-invariant';
import { createMemoryFactLog } from '../../fact-log/memory/create-memory-fact-log.ts';
import { createIngest } from '../../receive/create-ingest.ts';
import { buildStubReceiveDeployment } from '../../test-utils/build-stub-receive-deployment.ts';
import { createImpIdentitySenderProof } from './create-imp-identity-sender-proof.ts';
import { createIdentityIssuer } from './test-utils/create-identity-issuer.ts';
import type { ImpIdentityTrust } from './types.ts';

type Verify = typeof verifyImpIdentity;

function setupTest() {
  const stub = buildStubReceiveDeployment();
  const log = createMemoryFactLog([stub.streams.lamp]);
  const lines: string[] = [];
  const logger = createLogger({ write: (line) => lines.push(line) });

  return {
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
  };
}

test('it hands the verifier the header, the documents and audience of the path, and the time', async () => {
  const ctx = setupTest();

  const harbour = await createIdentityIssuer('harbour-host');

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

test.each([
  { row: 'no trust document', hasDocuments: false, hasAudience: true },
  { row: 'no audience', hasDocuments: true, hasAudience: false },
])(
  'it refuses every delivery with 401 when $row is configured, and never calls the verifier',
  async (row) => {
    const ctx = setupTest();

    const harbour = await createIdentityIssuer('harbour-host');

    const verify = mock<Verify>(() =>
      Promise.resolve({ issuer: 'harbour-host', id: 'imp-0193', name: 'tidy-otter' }),
    );

    const issuers = row.hasDocuments ? [harbour.document] : [];

    const audiences = row.hasAudience
      ? new Map([['BEACON_AUDIENCE', 'pepys-ingest']])
      : new Map<string, string>();

    const ingest = ctx.createIngestWith(verify, {
      issuers: new Map([['BEACON_ISSUERS', issuers]]),
      audiences,
    });

    const response = await ingest.handleRequest(
      ctx.buildRequest('/beacon/readings', { 'imp-identity': 'aGVhZA.Ym9keQ.c2ln' }),
    );

    expect({
      status: response.status,
      stored: await ctx.readStoredIDs(),
      verified: verify.mock.calls.length,
    }).toStrictEqual({ status: 401, stored: [], verified: 0 });
  },
);

test('it refuses with 401 when the verifier throws, and logs no token', async () => {
  const ctx = setupTest();

  const harbour = await createIdentityIssuer('harbour-host');

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

  const harbour = await createIdentityIssuer('harbour-host');

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

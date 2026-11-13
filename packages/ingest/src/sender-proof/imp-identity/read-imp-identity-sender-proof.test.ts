import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '@pepys/kit';
import type { SourceDefinition, StreamOffset } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import invariant from 'tiny-invariant';
import { createMemoryFactLog } from '../../fact-log/memory/create-memory-fact-log.ts';
import { createIngest } from '../../receive/create-ingest.ts';
import { buildStubReceiveDeployment } from '../../test-utils/build-stub-receive-deployment.ts';
import { readImpIdentitySenderProof } from './read-imp-identity-sender-proof.ts';
import { createIdentityIssuer } from './test-utils/create-identity-issuer.ts';
import type { IdentityIssuer, SignedTokens } from './test-utils/create-identity-issuer.ts';

async function setupTest() {
  const folder = await mkdtemp(join(tmpdir(), 'pepys-identity-'));

  onTestFinished(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  const stub = buildStubReceiveDeployment();
  const log = createMemoryFactLog([stub.streams.lamp]);
  const lines: string[] = [];
  const logger = createLogger({ write: (line) => lines.push(line) });

  return {
    folder,
    sources: stub.deployment.sources,
    writeTrustDocument: (issuer: IdentityIssuer) =>
      Bun.write(join(folder, `${issuer.document.issuer}.json`), JSON.stringify(issuer.document)),
    readSenderProof: (
      sources: readonly SourceDefinition[],
      environment: Readonly<Record<string, string | undefined>>,
    ) => readImpIdentitySenderProof({ sources, environment, now: () => 0, logger }),
    deliver: async (
      environment: Readonly<Record<string, string | undefined>>,
      nowMs: number,
      identity: readonly string[],
    ) => {
      const senderProof = await readImpIdentitySenderProof({
        sources: stub.deployment.sources,
        environment,
        now: () => nowMs,
        logger,
      });

      invariant(senderProof.ok, 'the trust folder loads');

      const ingest = createIngest({
        deployment: stub.deployment,
        secrets: { LEDGER_SECRET: 'till-secret', BEACON_TOKEN: 'tide-key', STRAY_TOKEN: 'stray' },
        log,
        senderProof: senderProof.value,
        appendRetry: { maxAttempts: 1, retryDelayMs: 0 },
        now: () => 0,
        logger,
      });

      const headers = new Headers({ authorization: 'Bearer tide-key' });

      for (const token of identity) {
        headers.append('imp-identity', token);
      }

      const response = await ingest.handleRequest(
        new Request('http://ingest.test/beacon/readings', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            readings: [{ lamp: 'north', at: '2026-11-11T02:20:00Z', level: 3 }],
          }),
        }),
      );

      const text = await response.text();

      return { status: response.status, text };
    },
    readLogged: () => [...lines],
    readStoredPayloads: async () => {
      const read = await log.read(stub.streams.lamp, toTagged<StreamOffset>(0), 100);

      invariant(read.ok, 'the stream exists');

      return read.value.map((item) => item.fact.payload);
    },
  };
}

test('it stores the issuer and subject of a good token as the origin', async () => {
  const ctx = await setupTest();
  const harbour = await createIdentityIssuer('harbour-host');

  await ctx.writeTrustDocument(harbour);

  const token = await harbour.signToken({
    audience: 'pepys-ingest',
    subject: 'imp-0193',
    name: 'tidy-otter',
    issuedAtSeconds: 1_794_370_812,
    expiresAtSeconds: 1_794_370_862,
  });

  const delivered = await ctx.deliver(
    { BEACON_ISSUERS: ctx.folder, BEACON_AUDIENCE: 'pepys-ingest' },
    1_794_370_814_000,
    [token],
  );

  expect({ status: delivered.status, stored: await ctx.readStoredPayloads() }).toStrictEqual({
    status: 200,
    stored: [{ level: 3, origin: { issuer: 'harbour-host', subject: 'imp-0193' } }],
  });
});

test.each([
  {
    row: 'a token of an issuer with no trust document',
    nowSeconds: 1_794_370_814,
    pickIdentity: (tokens: SignedTokens) => [tokens.otherIssuer],
  },
  {
    row: 'a token for another audience',
    nowSeconds: 1_794_370_814,
    pickIdentity: (tokens: SignedTokens) => [tokens.otherAudience],
  },
  {
    row: 'an expired token',
    nowSeconds: 1_794_370_873,
    pickIdentity: (tokens: SignedTokens) => [tokens.good],
  },
  {
    row: 'a token signed by another key under the same issuer and key ID',
    nowSeconds: 1_794_370_814,
    pickIdentity: (tokens: SignedTokens) => [tokens.forged],
  },
  {
    row: 'a good token with its signature changed',
    nowSeconds: 1_794_370_814,
    pickIdentity: (tokens: SignedTokens) => {
      const [header = '', claims = '', signature = ''] = tokens.good.split('.');
      const first = signature.startsWith('A') ? 'B' : 'A';

      return [`${header}.${claims}.${first}${signature.slice(1)}`];
    },
  },
  {
    row: 'no identity header',
    nowSeconds: 1_794_370_814,
    pickIdentity: (): string[] => [],
  },
  {
    row: 'a repeated identity header',
    nowSeconds: 1_794_370_814,
    pickIdentity: (tokens: SignedTokens) => [tokens.good, tokens.good],
  },
  {
    row: 'a malformed identity header',
    nowSeconds: 1_794_370_814,
    pickIdentity: () => ['Bearer let-me-in'],
  },
])('it refuses $row with 401 and stores nothing', async (row) => {
  const ctx = await setupTest();
  const harbour = await createIdentityIssuer('harbour-host');
  const other = await createIdentityIssuer('other-host');
  const forger = await createIdentityIssuer('harbour-host');

  await ctx.writeTrustDocument(harbour);

  const claims = {
    audience: 'pepys-ingest',
    subject: 'imp-0193',
    name: 'tidy-otter',
    issuedAtSeconds: 1_794_370_812,
    expiresAtSeconds: 1_794_370_862,
  };

  const tokens: SignedTokens = {
    good: await harbour.signToken(claims),
    otherIssuer: await other.signToken(claims),
    otherAudience: await harbour.signToken({ ...claims, audience: 'lantern-ingest' }),
    forged: await forger.signToken(claims),
  };

  const identity = row.pickIdentity(tokens);

  const delivered = await ctx.deliver(
    { BEACON_ISSUERS: ctx.folder, BEACON_AUDIENCE: 'pepys-ingest' },
    row.nowSeconds * 1000,
    identity,
  );

  expect({ status: delivered.status, stored: await ctx.readStoredPayloads() }).toStrictEqual({
    status: 401,
    stored: [],
  });
});

test('it puts no token, secret or record in a refusal answer or a log line', async () => {
  const ctx = await setupTest();
  const harbour = await createIdentityIssuer('harbour-host');

  await ctx.writeTrustDocument(harbour);

  const token = await harbour.signToken({
    audience: 'lantern-ingest',
    subject: 'imp-0193',
    name: 'tidy-otter',
    issuedAtSeconds: 1_794_370_812,
    expiresAtSeconds: 1_794_370_862,
  });

  const delivered = await ctx.deliver(
    { BEACON_ISSUERS: ctx.folder, BEACON_AUDIENCE: 'pepys-ingest' },
    1_794_370_814_000,
    [token],
  );

  const secrets = [
    token,
    token.split('.')[2] ?? token,
    'tide-key',
    'north',
    '2026-11-11T02:20:00Z',
  ];

  const lines = [delivered.text, ...ctx.readLogged()];

  expect({
    status: delivered.status,
    leaks: lines.filter((line) => secrets.some((secret) => line.includes(secret))),
  }).toStrictEqual({ status: 401, leaks: [] });
});

test.each([
  { row: 'no setting', audience: undefined },
  { row: 'no trust folder', audience: 'pepys-ingest' },
])('it starts with $row and refuses a signed token with 401', async (row) => {
  const ctx = await setupTest();
  const harbour = await createIdentityIssuer('harbour-host');

  await ctx.writeTrustDocument(harbour);

  const token = await harbour.signToken({
    audience: 'pepys-ingest',
    subject: 'imp-0193',
    name: 'tidy-otter',
    issuedAtSeconds: 1_794_370_812,
    expiresAtSeconds: 1_794_370_862,
  });

  const delivered = await ctx.deliver(
    { BEACON_ISSUERS: undefined, BEACON_AUDIENCE: row.audience },
    1_794_370_814_000,
    [token],
  );

  expect({ status: delivered.status, stored: await ctx.readStoredPayloads() }).toStrictEqual({
    status: 401,
    stored: [],
  });
});

test.each([
  { row: 'no audience', audience: undefined, tokenAudience: 'pepys-ingest' },
  { row: 'an empty audience', audience: '', tokenAudience: '' },
])('it starts with a trust folder and $row and refuses a signed token with 401', async (row) => {
  const ctx = await setupTest();
  const harbour = await createIdentityIssuer('harbour-host');

  await ctx.writeTrustDocument(harbour);

  const token = await harbour.signToken({
    audience: row.tokenAudience,
    subject: 'imp-0193',
    name: 'tidy-otter',
    issuedAtSeconds: 1_794_370_812,
    expiresAtSeconds: 1_794_370_862,
  });

  const delivered = await ctx.deliver(
    { BEACON_ISSUERS: ctx.folder, BEACON_AUDIENCE: row.audience },
    1_794_370_814_000,
    [token],
  );

  expect({ status: delivered.status, stored: await ctx.readStoredPayloads() }).toStrictEqual({
    status: 401,
    stored: [],
  });
});

test('it reads no setting for a deployment with no path that needs a sender', async () => {
  const ctx = await setupTest();

  const proof = await ctx.readSenderProof(
    ctx.sources.filter(
      (source) => source.live?.kind !== 'receive' || source.live.sender === undefined,
    ),
    { BEACON_ISSUERS: join(ctx.folder, 'missing') },
  );

  expect(proof.ok).toBeTrue();
});

test('it fails the start on a trust folder that cannot be read, for a path that needs a sender', async () => {
  const ctx = await setupTest();

  const proof = await ctx.readSenderProof(ctx.sources, {
    BEACON_ISSUERS: join(ctx.folder, 'missing'),
  });

  expect(proof).toStrictEqual({
    ok: false,
    failure: expect.stringContaining('the trust documents cannot be read'),
  });
});

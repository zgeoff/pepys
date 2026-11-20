import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IdentityTrustDocument } from '@impz/client/identity';
import { createTestIdentityIssuer } from '@impz/testing/identity';
import invariant from 'tiny-invariant';
import { buildStubReceiveDeployment } from '../../test-utils/build-stub-receive-deployment.ts';
import { readImpIdentityTrust } from './read-imp-identity-trust.ts';

interface GroupAudiences {
  imps: string;
  forwarders: string;
}

async function setupTest() {
  const folder = await mkdtemp(join(tmpdir(), 'pepys-trust-'));

  onTestFinished(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  const forwarderFolder = await mkdtemp(join(tmpdir(), 'pepys-trust-forwarders-'));

  onTestFinished(async () => {
    await rm(forwarderFolder, { recursive: true, force: true });
  });

  const sources = buildStubReceiveDeployment().deployment.sources;

  return {
    folder,
    forwarderFolder,
    read: (environment: Readonly<Record<string, string | undefined>>) =>
      readImpIdentityTrust({ sources, environment }),
    readGroups: (audiences: GroupAudiences) =>
      readImpIdentityTrust({
        sources,
        environment: {
          BEACON_ISSUERS: folder,
          BEACON_AUDIENCE: audiences.imps,
          BEACON_FORWARDER_ISSUERS: forwarderFolder,
          BEACON_FORWARDER_AUDIENCE: audiences.forwarders,
        },
      }),
  };
}

test('it reads each JSON document in the folder that the variable names, and the audience', async () => {
  const ctx = await setupTest();
  const hostA = await createTestIdentityIssuer({ issuer: 'host-a' });
  const hostB = await createTestIdentityIssuer({ issuer: 'host-b' });

  await Bun.write(join(ctx.folder, 'host-a.json'), JSON.stringify(hostA.document));
  await Bun.write(join(ctx.folder, 'host-b.json'), JSON.stringify(hostB.document));
  await Bun.write(join(ctx.folder, 'notes.txt'), 'not a document');

  const trust = await ctx.read({ BEACON_ISSUERS: ctx.folder, BEACON_AUDIENCE: 'pepys-ingest' });

  expect(trust).toStrictEqual({
    ok: true,
    value: {
      issuers: new Map([['BEACON_ISSUERS', [hostA.document, hostB.document]]]),
      audiences: new Map([['BEACON_AUDIENCE', 'pepys-ingest']]),
    },
  });
});

test('it holds no trust documents for an unset variable', async () => {
  const ctx = await setupTest();
  const trust = await ctx.read({ BEACON_ISSUERS: undefined, BEACON_AUDIENCE: 'pepys-ingest' });

  expect(trust).toStrictEqual({
    ok: true,
    value: { issuers: new Map(), audiences: new Map([['BEACON_AUDIENCE', 'pepys-ingest']]) },
  });
});

test('it holds no trust documents for a folder with no document', async () => {
  const ctx = await setupTest();
  const trust = await ctx.read({ BEACON_ISSUERS: ctx.folder, BEACON_AUDIENCE: 'pepys-ingest' });

  expect(trust).toStrictEqual({
    ok: true,
    value: { issuers: new Map(), audiences: new Map([['BEACON_AUDIENCE', 'pepys-ingest']]) },
  });
});

test.each([
  { row: 'an unset audience', audience: undefined },
  { row: 'an empty audience', audience: '' },
])('it holds no audience for $row', async (row) => {
  const ctx = await setupTest();
  const hostA = await createTestIdentityIssuer({ issuer: 'host-a' });

  await Bun.write(join(ctx.folder, 'host-a.json'), JSON.stringify(hostA.document));

  const trust = await ctx.read({ BEACON_ISSUERS: ctx.folder, BEACON_AUDIENCE: row.audience });

  expect(trust).toStrictEqual({
    ok: true,
    value: {
      issuers: new Map([['BEACON_ISSUERS', [hostA.document]]]),
      audiences: new Map(),
    },
  });
});

test.each([
  {
    row: 'a document with no key',
    buildDocuments: (document: IdentityTrustDocument) => [{ ...document, keys: [] }],
  },
  {
    row: 'two documents of one issuer',
    buildDocuments: (document: IdentityTrustDocument) => [document, document],
  },
])('it fails on $row', async (row) => {
  const ctx = await setupTest();
  const hostA = await createTestIdentityIssuer({ issuer: 'host-a' });

  for (const [index, document] of row.buildDocuments(hostA.document).entries()) {
    await Bun.write(join(ctx.folder, `host-${index}.json`), JSON.stringify(document));
  }

  const trust = await ctx.read({ BEACON_ISSUERS: ctx.folder });

  expect(trust).toStrictEqual({
    ok: false,
    failure: expect.stringContaining('the trust documents are invalid'),
  });
});

test('it fails on a folder that cannot be read', async () => {
  const ctx = await setupTest();
  const trust = await ctx.read({ BEACON_ISSUERS: join(ctx.folder, 'missing') });

  expect(trust).toStrictEqual({
    ok: false,
    failure: expect.stringContaining('the trust documents cannot be read'),
  });
});

test('it reads the variables of a sender route beside those of its path', async () => {
  const ctx = await setupTest();
  const imps = await createTestIdentityIssuer({ issuer: 'harbour-host' });
  const forwarders = await createTestIdentityIssuer({ issuer: 'study-pc' });

  await Bun.write(join(ctx.folder, 'imps.json'), JSON.stringify(imps.document));
  await Bun.write(join(ctx.forwarderFolder, 'study.json'), JSON.stringify(forwarders.document));

  const trust = await ctx.readGroups({ imps: 'pepys-ingest', forwarders: 'pepys-forwarders' });

  expect(trust).toStrictEqual({
    ok: true,
    value: {
      issuers: new Map([
        ['BEACON_ISSUERS', [imps.document]],
        ['BEACON_FORWARDER_ISSUERS', [forwarders.document]],
      ]),
      audiences: new Map([
        ['BEACON_AUDIENCE', 'pepys-ingest'],
        ['BEACON_FORWARDER_AUDIENCE', 'pepys-forwarders'],
      ]),
    },
  });
});

test('it fails when a sender route and its path have one audience', async () => {
  const ctx = await setupTest();
  const imps = await createTestIdentityIssuer({ issuer: 'harbour-host' });
  const forwarders = await createTestIdentityIssuer({ issuer: 'study-pc' });

  await Bun.write(join(ctx.folder, 'imps.json'), JSON.stringify(imps.document));
  await Bun.write(join(ctx.forwarderFolder, 'study.json'), JSON.stringify(forwarders.document));

  const trust = await ctx.readGroups({ imps: 'pepys-ingest', forwarders: 'pepys-ingest' });

  expect(trust).toStrictEqual({
    ok: false,
    failure: expect.stringContaining('has the same audience as its path'),
  });
});

test('it fails when one issuer name is in both folders', async () => {
  const ctx = await setupTest();
  const imps = await createTestIdentityIssuer({ issuer: 'harbour-host' });
  const forwarders = await createTestIdentityIssuer({ issuer: 'harbour-host' });

  await Bun.write(join(ctx.folder, 'imps.json'), JSON.stringify(imps.document));
  await Bun.write(join(ctx.forwarderFolder, 'study.json'), JSON.stringify(forwarders.document));

  const trust = await ctx.readGroups({ imps: 'pepys-ingest', forwarders: 'pepys-forwarders' });

  expect(trust).toStrictEqual({
    ok: false,
    failure: expect.stringContaining('trusts the issuer harbour-host, which its path trusts too'),
  });
});

test('it fails when one key is in both folders under two issuer names and two key IDs', async () => {
  const ctx = await setupTest();
  const imps = await createTestIdentityIssuer({ issuer: 'harbour-host' });

  const [key] = imps.document.keys;

  invariant(key !== undefined, 'the issuer has a key');

  const copy: IdentityTrustDocument = {
    ...imps.document,
    issuer: 'study-pc',
    keys: [{ ...key, kid: 'key-copy' }],
  };

  await Bun.write(join(ctx.folder, 'imps.json'), JSON.stringify(imps.document));
  await Bun.write(join(ctx.forwarderFolder, 'study.json'), JSON.stringify(copy));

  const trust = await ctx.readGroups({ imps: 'pepys-ingest', forwarders: 'pepys-forwarders' });

  expect(trust).toStrictEqual({
    ok: false,
    failure: expect.stringContaining('trusts a key of the issuer study-pc'),
  });
});

test('it starts when the forwarder side has no audience, even with one issuer name in both folders', async () => {
  const ctx = await setupTest();
  const imps = await createTestIdentityIssuer({ issuer: 'harbour-host' });
  const forwarders = await createTestIdentityIssuer({ issuer: 'harbour-host' });

  await Bun.write(join(ctx.folder, 'imps.json'), JSON.stringify(imps.document));
  await Bun.write(join(ctx.forwarderFolder, 'study.json'), JSON.stringify(forwarders.document));

  const trust = await ctx.readGroups({ imps: 'pepys-ingest', forwarders: '' });

  expect(trust.ok).toBe(true);
});

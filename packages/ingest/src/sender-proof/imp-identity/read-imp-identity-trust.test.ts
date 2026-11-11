import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildStubReceiveDeployment } from '../../test-utils/build-stub-receive-deployment.ts';
import { readImpIdentityTrust } from './read-imp-identity-trust.ts';

async function setupTest() {
  const folder = await mkdtemp(join(tmpdir(), 'pepys-trust-'));

  onTestFinished(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  return {
    folder,
    read: (environment: Readonly<Record<string, string | undefined>>) =>
      readImpIdentityTrust({
        sources: buildStubReceiveDeployment().deployment.sources,
        environment,
        loadIssuers: (documents) =>
          documents.map((document) => {
            if (typeof document !== 'object' || document === null || !('issuer' in document)) {
              throw new Error('a trust document names its issuer');
            }

            return document;
          }),
      }),
  };
}

test('it reads each JSON document in the folder that the variable names, and the audience', async () => {
  const ctx = await setupTest();

  await Bun.write(join(ctx.folder, 'host-a.json'), JSON.stringify({ issuer: 'host-a' }));
  await Bun.write(join(ctx.folder, 'host-b.json'), JSON.stringify({ issuer: 'host-b' }));
  await Bun.write(join(ctx.folder, 'notes.txt'), 'not a document');

  const trust = await ctx.read({ BEACON_ISSUERS: ctx.folder, BEACON_AUDIENCE: 'pepys-ingest' });

  expect(trust).toStrictEqual({
    ok: true,
    value: {
      issuers: new Map([['BEACON_ISSUERS', [{ issuer: 'host-a' }, { issuer: 'host-b' }]]]),
      audiences: new Map([['BEACON_AUDIENCE', 'pepys-ingest']]),
    },
  });
});

test.each([
  { row: 'an unset variable', isSet: false },
  { row: 'a folder with no document', isSet: true },
])('it holds no trust documents for $row', async (row) => {
  const ctx = await setupTest();

  const trust = await ctx.read({
    BEACON_ISSUERS: row.isSet ? ctx.folder : undefined,
    BEACON_AUDIENCE: 'pepys-ingest',
  });

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

  await Bun.write(join(ctx.folder, 'host-a.json'), JSON.stringify({ issuer: 'host-a' }));

  const trust = await ctx.read({ BEACON_ISSUERS: ctx.folder, BEACON_AUDIENCE: row.audience });

  expect(trust).toStrictEqual({
    ok: true,
    value: {
      issuers: new Map([['BEACON_ISSUERS', [{ issuer: 'host-a' }]]]),
      audiences: new Map(),
    },
  });
});

test('it fails on a document that the verifier refuses', async () => {
  const ctx = await setupTest();

  await Bun.write(join(ctx.folder, 'host-a.json'), JSON.stringify({ keys: [] }));

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

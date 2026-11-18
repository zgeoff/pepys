import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import invariant from 'tiny-invariant';
import { buildTrustDocument } from './build-trust-document.ts';
import { createIdentity } from './create-identity.ts';
import { readIdentity } from './read-identity.ts';

async function setupTest() {
  const folder = await mkdtemp(join(tmpdir(), 'pepys-identity-'));

  onTestFinished(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  const identityDir = join(folder, 'identity');

  return {
    identityDir,
    createIdentity: (issuer: string, id: string) =>
      createIdentity({ folder: identityDir, issuer, randomID: () => id }),
    readMode: async (name: string) => {
      const stats = await stat(join(identityDir, name));

      return stats.mode & 0o777;
    },
    readFile: (name: string) => readFile(join(identityDir, name), 'utf8'),
    readJSON: async (name: string) => {
      const text = await readFile(join(identityDir, name), 'utf8');

      const parsed: unknown = JSON.parse(text);

      return parsed;
    },
  };
}

test('#createIdentity makes the key and the machine ID in files of mode 0600, in a folder of mode 0700', async () => {
  const ctx = await setupTest();

  await ctx.createIdentity('study-pc', 'id-1');

  expect({
    folder: await ctx.readMode('.'),
    key: await ctx.readMode('private-key.json'),
    machine: await ctx.readMode('machine.json'),
    stored: await ctx.readJSON('machine.json'),
  }).toStrictEqual({
    folder: 0o700,
    key: 0o600,
    machine: 0o600,
    stored: { issuer: 'study-pc', id: 'id-1' },
  });
});

test('#createIdentity keeps the key and the ID of a second run, so the trust document stays the same', async () => {
  const ctx = await setupTest();
  const first = await ctx.createIdentity('study-pc', 'id-1');
  const second = await ctx.createIdentity('study-pc', 'id-2');

  invariant(first.ok && second.ok, 'both runs succeed');

  expect({
    document: buildTrustDocument(second.value),
    id: second.value.id,
  }).toStrictEqual({ document: buildTrustDocument(first.value), id: 'id-1' });
});

test('#createIdentity fails when the stored issuer differs, and replaces nothing', async () => {
  const ctx = await setupTest();

  await ctx.createIdentity('study-pc', 'id-1');

  const before = await ctx.readFile('private-key.json');
  const second = await ctx.createIdentity('office-pc', 'id-2');

  expect({
    second,
    key: await ctx.readFile('private-key.json'),
    machine: await ctx.readJSON('machine.json'),
  }).toStrictEqual({
    second: { ok: false, failure: 'the identity folder holds the issuer study-pc, not office-pc' },
    key: before,
    machine: { issuer: 'study-pc', id: 'id-1' },
  });
});

test('#createIdentity fails on a key file it cannot read, and replaces nothing', async () => {
  const ctx = await setupTest();

  await ctx.createIdentity('study-pc', 'id-1');

  await writeFile(join(ctx.identityDir, 'private-key.json'), 'garbled');

  const second = await ctx.createIdentity('study-pc', 'id-1');

  expect({ ok: second.ok, key: await ctx.readFile('private-key.json') }).toStrictEqual({
    ok: false,
    key: 'garbled',
  });
});

test('#readIdentity fails when the identity folder holds no key and no machine ID', async () => {
  const ctx = await setupTest();
  const identity = await readIdentity(ctx.identityDir);

  expect(identity.ok).toBeFalse();
});

test('#readIdentity reads what #createIdentity made', async () => {
  const ctx = await setupTest();
  const created = await ctx.createIdentity('study-pc', 'id-1');
  const read = await readIdentity(ctx.identityDir);

  invariant(created.ok && read.ok, 'both succeed');

  expect({ issuer: read.value.issuer, id: read.value.id, kid: read.value.kid }).toStrictEqual({
    issuer: 'study-pc',
    id: 'id-1',
    kid: created.value.kid,
  });
});

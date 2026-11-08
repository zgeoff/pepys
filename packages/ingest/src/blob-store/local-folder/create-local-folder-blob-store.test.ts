import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BlobHash } from '@pepys/schema';
import { toTagged } from '@zgeoff/std';
import { createLocalFolderBlobStore } from './create-local-folder-blob-store.ts';

async function setupTest() {
  const directory = await mkdtemp(join(tmpdir(), 'pepys-blobs-'));

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  return { directory, store: createLocalFolderBlobStore(join(directory, 'blobs')) };
}

test('it reports a missing blob for a hash that names a path outside the folder', async () => {
  const ctx = await setupTest();

  await Bun.write(join(ctx.directory, 'outside'), 'the harbour map');

  const read = await ctx.store.read(toTagged<BlobHash>('../outside'));

  expect(read).toStrictEqual({ ok: false, failure: { reason: 'missing' } });
});

test('it reports a write to a folder that does not exist as unavailable', async () => {
  const ctx = await setupTest();
  const written = await ctx.store.write(new TextEncoder().encode('the harbour map'));

  expect(written).toStrictEqual({ ok: false, failure: { reason: 'unavailable' } });
});

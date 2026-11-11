import { rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BlobHash, Result } from '@pepys/kit';
import type { BlobStore } from '../blob-store.ts';
import { buildBlobHash } from '../build-blob-hash.ts';

export function createLocalFolderBlobStore(directory: string): BlobStore {
  return {
    write: (bytes) => writeBlob(directory, bytes),
    read: (hash) => readBlob(directory, hash),
  };
}

// A blob lands under its hash only once its bytes are complete, so a reader never sees part of one.
async function writeBlob(
  directory: string,
  bytes: Uint8Array,
): Promise<Result<BlobHash, { reason: 'unavailable' }>> {
  const hash = buildBlobHash(bytes);
  const partial = join(directory, `${hash}.${crypto.randomUUID()}.partial`);

  try {
    await writeFile(partial, bytes);
    await rename(partial, join(directory, hash));
  } catch {
    await rm(partial, { force: true });

    return { ok: false, failure: { reason: 'unavailable' } };
  }

  return { ok: true, value: hash };
}

const blobHashPattern = /^[0-9a-f]{64}$/u;

async function readBlob(
  directory: string,
  hash: BlobHash,
): Promise<Result<Uint8Array, { reason: 'missing' | 'unavailable' }>> {
  // A hash that is not a SHA-256 in hex could name a path outside the folder.
  if (!blobHashPattern.test(hash)) {
    return { ok: false, failure: { reason: 'missing' } };
  }

  const file = Bun.file(join(directory, hash));

  if (!(await file.exists())) {
    return { ok: false, failure: { reason: 'missing' } };
  }

  try {
    return { ok: true, value: await file.bytes() };
  } catch {
    return { ok: false, failure: { reason: 'unavailable' } };
  }
}

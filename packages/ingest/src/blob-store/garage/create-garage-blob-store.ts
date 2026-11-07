import type { BlobHash, Result } from '@pepys/schema';
import type { BlobStore } from '../blob-store.ts';
import { buildBlobHash } from '../build-blob-hash.ts';

interface GarageBlobStoreParameters {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyID: string;
  secretAccessKey: string;
}

export function createGarageBlobStore(parameters: GarageBlobStoreParameters): BlobStore {
  const client = new Bun.S3Client({
    endpoint: parameters.endpoint,
    region: parameters.region,
    bucket: parameters.bucket,
    accessKeyId: parameters.accessKeyID,
    secretAccessKey: parameters.secretAccessKey,
  });

  return {
    write: (bytes) => writeBlob(client, bytes),
    read: (hash) => readBlob(client, hash),
  };
}

async function writeBlob(
  client: Bun.S3Client,
  bytes: Uint8Array,
): Promise<Result<BlobHash, { reason: 'unavailable' }>> {
  const hash = buildBlobHash(bytes);

  try {
    await client.write(hash, bytes);
  } catch {
    return { ok: false, failure: { reason: 'unavailable' } };
  }

  return { ok: true, value: hash };
}

async function readBlob(
  client: Bun.S3Client,
  hash: BlobHash,
): Promise<Result<Uint8Array, { reason: 'missing' | 'unavailable' }>> {
  try {
    return { ok: true, value: await client.file(hash).bytes() };
  } catch (error: unknown) {
    if (isMissingKey(error)) {
      return { ok: false, failure: { reason: 'missing' } };
    }

    return { ok: false, failure: { reason: 'unavailable' } };
  }
}

function isMissingKey(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'NoSuchKey';
}

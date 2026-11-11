import type { BlobHash, Result } from '@pepys/kit';
import type { BlobStore } from '../blob-store.ts';
import { buildBlobHash } from '../build-blob-hash.ts';

interface GarageBlobStoreParameters {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyID: string;
  secretAccessKey: string;
  requestTimeoutMs: number;
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
    write: (bytes) => writeBlob(client, bytes, parameters.requestTimeoutMs),
    read: (hash) => readBlob(client, hash, parameters.requestTimeoutMs),
  };
}

async function writeBlob(
  client: Bun.S3Client,
  bytes: Uint8Array,
  timeoutMs: number,
): Promise<Result<BlobHash, { reason: 'unavailable' }>> {
  const hash = buildBlobHash(bytes);

  try {
    await withTimeout(timeoutMs, () => client.write(hash, bytes));
  } catch {
    return { ok: false, failure: { reason: 'unavailable' } };
  }

  return { ok: true, value: hash };
}

// The S3 client sets no request timeout of its own, so a store that never answers would hold the
// caller forever.
async function withTimeout<Value>(
  timeoutMs: number,
  request: () => Promise<Value>,
): Promise<Value> {
  const timeout = Promise.withResolvers<never>();

  const timer = setTimeout(() => {
    timeout.reject(new Error(`the request had no answer after ${timeoutMs} ms`));
  }, timeoutMs);

  try {
    return await Promise.race([request(), timeout.promise]);
  } finally {
    clearTimeout(timer);
  }
}

async function readBlob(
  client: Bun.S3Client,
  hash: BlobHash,
  timeoutMs: number,
): Promise<Result<Uint8Array, { reason: 'missing' | 'unavailable' }>> {
  try {
    return { ok: true, value: await withTimeout(timeoutMs, () => client.file(hash).bytes()) };
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

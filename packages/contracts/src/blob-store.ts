import type { Result } from '@pepys/schema';
import type { BlobHash } from './ids.ts';

// The driven port to the blobs bucket. Adapters: Garage, and a local folder for tests. A blob is
// named by its content hash, so a repeated write is harmless and a read never sees other bytes.
export interface BlobStore {
  write: (bytes: Uint8Array) => Promise<Result<BlobHash, { reason: 'unavailable' }>>;
  read: (hash: BlobHash) => Promise<Result<Uint8Array, { reason: 'missing' | 'unavailable' }>>;
}

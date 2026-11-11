import type { BlobHash, Result } from '@pepys/kit';

export interface BlobStore {
  write: (bytes: Uint8Array) => Promise<Result<BlobHash, { reason: 'unavailable' }>>;
  read: (hash: BlobHash) => Promise<Result<Uint8Array, { reason: 'missing' | 'unavailable' }>>;
}

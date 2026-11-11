import type { BlobHash } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';

export function buildBlobHash(bytes: Uint8Array): BlobHash {
  return toTagged<BlobHash>(new Bun.CryptoHasher('sha256').update(bytes).digest('hex'));
}

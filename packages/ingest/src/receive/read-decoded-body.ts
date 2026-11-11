import { readStreamUpTo } from './read-stream-up-to.ts';

export type DecodedBody = Uint8Array | 'unsupported' | 'too-large' | 'corrupt';

// No `content-encoding`: the bytes as sent. `gzip` on a path that takes it: the bytes gunzipped as a
// stream that stops at `limitBytes` decoded bytes, so a small body cannot unpack to a large one. Any
// other value is `unsupported`, and a gzip body that does not gunzip is `corrupt`.
export async function readDecodedBody(
  sent: Uint8Array,
  encoding: string | null,
  accepted: readonly 'gzip'[],
  limitBytes: number,
): Promise<DecodedBody> {
  if (encoding === null) {
    return sent;
  }

  if (encoding.trim().toLowerCase() !== 'gzip' || !accepted.includes('gzip')) {
    return 'unsupported';
  }

  // the copy is a Uint8Array over an ArrayBuffer, which the ESNext lib's BlobPart needs; a plugin's
  // own compiler checks this file with its own lib
  const decoded = new Blob([new Uint8Array(sent)])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));

  try {
    return await readStreamUpTo(decoded, limitBytes);
  } catch {
    return 'corrupt';
  }
}

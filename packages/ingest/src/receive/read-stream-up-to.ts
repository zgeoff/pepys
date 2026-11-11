// Reads a stream until it ends, or cancels it as soon as more than `limitBytes` have arrived, so a
// body over the limit is never held whole.
export async function readStreamUpTo(
  stream: ReadableStream<Uint8Array>,
  limitBytes: number,
): Promise<Uint8Array | 'too-large'> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const read = await reader.read();

    if (read.done) {
      break;
    }

    total += read.value.byteLength;

    if (total > limitBytes) {
      await reader.cancel();

      return 'too-large';
    }

    chunks.push(read.value);
  }

  return joinChunks(chunks, total);
}

function joinChunks(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const joined = new Uint8Array(total);

  let offset = 0;

  for (const chunk of chunks) {
    joined.set(chunk, offset);

    offset += chunk.byteLength;
  }

  return joined;
}

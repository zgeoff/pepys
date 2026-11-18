export type SpoolRead =
  | { kind: 'line'; text: string; nextOffset: number }
  | { kind: 'none' }
  | { kind: 'past-end' };

const chunkBytes = 1_048_576;

// The line at a byte offset of a spool file. A line that ends in no line break counts only when
// `acceptPartial` is true, because the receiver may still be writing it.
export async function readSpoolLine(
  path: string,
  offset: number,
  acceptPartial: boolean,
): Promise<SpoolRead> {
  const file = Bun.file(path);
  const size = file.size;

  if (offset > size) {
    return { kind: 'past-end' };
  }

  let length = chunkBytes;

  for (;;) {
    const end = Math.min(offset + length, size);

    const buffer = await file.slice(offset, end).arrayBuffer();

    const bytes = new Uint8Array(buffer);

    const lineBreak = bytes.indexOf(0x0a);

    if (lineBreak !== -1) {
      return {
        kind: 'line',
        text: new TextDecoder().decode(bytes.subarray(0, lineBreak)),
        nextOffset: offset + lineBreak + 1,
      };
    }

    if (end < size) {
      length *= 2;
      continue;
    }

    if (bytes.length === 0 || !acceptPartial) {
      return { kind: 'none' };
    }

    return { kind: 'line', text: new TextDecoder().decode(bytes), nextOffset: end };
  }
}

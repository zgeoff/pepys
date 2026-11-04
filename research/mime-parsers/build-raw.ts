type Part = string | Uint8Array;

export function buildRaw(parts: Part[], lineEnding: 'crlf' | 'lf' = 'crlf'): Uint8Array {
  const encoder = new TextEncoder();

  const chunks = parts.map((part) => {
    const bytes = typeof part === 'string' ? encoder.encode(part) : part;

    return lineEnding === 'crlf' ? buildCRLF(bytes) : bytes;
  });

  return concatBytes(chunks);
}

// Rewrites each bare LF as CRLF, and leaves an existing CRLF alone.
function buildCRLF(bytes: Uint8Array): Uint8Array {
  const out: number[] = [];

  for (const [index, byte] of bytes.entries()) {
    if (byte === 0x0a && bytes[index - 1] !== 0x0d) {
      out.push(0x0d);
    }

    out.push(byte);
  }

  return Uint8Array.from(out);
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);

  const out = new Uint8Array(total);

  let offset = 0;

  for (const chunk of chunks) {
    out.set(chunk, offset);

    offset += chunk.length;
  }

  return out;
}

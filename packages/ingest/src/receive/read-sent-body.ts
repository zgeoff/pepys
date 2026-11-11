import { readStreamUpTo } from './read-stream-up-to.ts';

// The body as sent, up to `limitBytes`. A `content-length` over the limit refuses before any read,
// and the count while reading refuses a body whose header understates it.
export async function readSentBody(
  request: Request,
  limitBytes: number,
): Promise<Uint8Array | 'too-large'> {
  const declared = Number(request.headers.get('content-length') ?? '0');

  if (declared > limitBytes) {
    return 'too-large';
  }

  if (request.body === null) {
    return new Uint8Array(0);
  }

  const body = await readStreamUpTo(request.body, limitBytes);

  return body;
}

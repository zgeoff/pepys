import { expect, test } from 'bun:test';
import { buildStubCountedStream } from '../test-utils/build-stub-counted-stream.ts';
import { readStreamUpTo } from './read-stream-up-to.ts';

test('it returns every byte of a stream within the limit, in order', async () => {
  const counted = buildStubCountedStream(new TextEncoder().encode('tide table'), 3);

  const read = await readStreamUpTo(counted.stream, 10);

  expect(read).toStrictEqual(new TextEncoder().encode('tide table'));
});

test('it refuses a stream one byte over the limit and cancels it', async () => {
  const counted = buildStubCountedStream(new Uint8Array(11), 4);

  const read = await readStreamUpTo(counted.stream, 10);

  expect({ read, isCancelled: counted.counts.isCancelled }).toStrictEqual({
    read: 'too-large',
    isCancelled: true,
  });
});

test('it stops a gzip stream at the decoded limit after it reads a small part of the gzip body', async () => {
  // 16 MiB of zeros gzips to about 16 KiB, and the limit is 64 KiB of decoded bytes
  const gzipped = Bun.gzipSync(new Uint8Array(16 * 1_048_576));
  const counted = buildStubCountedStream(gzipped, 256);
  const decoded = counted.stream.pipeThrough(new DecompressionStream('gzip'));

  const read = await readStreamUpTo(decoded, 65_536);

  expect({
    read,
    isCancelled: counted.counts.isCancelled,
    pulledLessThanAQuarter: counted.counts.pulledBytes < gzipped.byteLength / 4,
  }).toStrictEqual({ read: 'too-large', isCancelled: true, pulledLessThanAQuarter: true });
});

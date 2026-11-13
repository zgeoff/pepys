import { expect, test } from 'bun:test';
import { buildStubCountedStream } from './build-stub-counted-stream.ts';

test('it hands out the bytes in chunks of the given size, then closes', async () => {
  const counted = buildStubCountedStream(new TextEncoder().encode('tide table'), 4);

  const chunks = await Array.fromAsync(counted.stream);

  expect(chunks.map((chunk) => new TextDecoder().decode(chunk))).toStrictEqual([
    'tide',
    ' tab',
    'le',
  ]);
});

test('it counts every byte of a stream the reader read to the end', async () => {
  const counted = buildStubCountedStream(new Uint8Array(10), 4);

  await Array.fromAsync(counted.stream);

  expect(counted.counts).toStrictEqual({ pulledBytes: 10, isCancelled: false });
});

test('it records that the reader cancelled the stream', async () => {
  const counted = buildStubCountedStream(new Uint8Array(10), 4);

  await counted.stream.cancel();

  expect(counted.counts).toStrictEqual({ pulledBytes: 0, isCancelled: true });
});

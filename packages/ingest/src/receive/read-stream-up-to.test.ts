import { expect, test } from 'bun:test';
import { readStreamUpTo } from './read-stream-up-to.ts';

function setupTest() {
  const state = { pulledBytes: 0, isCancelled: false };

  return {
    state,

    // hands out `bytes` in chunks of `chunkBytes` on demand, and counts what it handed out
    buildCountedStream: (bytes: Uint8Array<ArrayBuffer>, chunkBytes: number) =>
      new ReadableStream<Uint8Array<ArrayBuffer>>({
        pull: (controller) => {
          if (state.pulledBytes >= bytes.byteLength) {
            controller.close();

            return;
          }

          const chunk = bytes.subarray(state.pulledBytes, state.pulledBytes + chunkBytes);

          state.pulledBytes += chunk.byteLength;

          controller.enqueue(chunk);
        },
        cancel: () => {
          state.isCancelled = true;
        },
      }),
  };
}

test('it returns every byte of a stream within the limit, in order', async () => {
  const ctx = setupTest();
  const stream = ctx.buildCountedStream(new TextEncoder().encode('tide table'), 3);

  const read = await readStreamUpTo(stream, 10);

  expect(read).toStrictEqual(new TextEncoder().encode('tide table'));
});

test('it refuses a stream one byte over the limit and cancels it', async () => {
  const ctx = setupTest();
  const stream = ctx.buildCountedStream(new Uint8Array(11), 4);

  const read = await readStreamUpTo(stream, 10);

  expect({ read, isCancelled: ctx.state.isCancelled }).toStrictEqual({
    read: 'too-large',
    isCancelled: true,
  });
});

test('it stops a gzip stream at the decoded limit after it reads a small part of the gzip body', async () => {
  const ctx = setupTest();

  // 16 MiB of zeros gzips to about 16 KiB, and the limit is 64 KiB of decoded bytes
  const gzipped = Bun.gzipSync(new Uint8Array(16 * 1_048_576));
  const decoded = ctx.buildCountedStream(gzipped, 256).pipeThrough(new DecompressionStream('gzip'));

  const read = await readStreamUpTo(decoded, 65_536);

  expect({
    read,
    isCancelled: ctx.state.isCancelled,
    pulledLessThanAQuarter: ctx.state.pulledBytes < gzipped.byteLength / 4,
  }).toStrictEqual({ read: 'too-large', isCancelled: true, pulledLessThanAQuarter: true });
});

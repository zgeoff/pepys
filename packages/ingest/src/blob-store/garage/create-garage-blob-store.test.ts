import { expect, onTestFinished, test } from 'bun:test';
import type { BlobHash } from '@pepys/schema';
import { toTagged } from '@zgeoff/std';
import { createGarageBlobStore } from './create-garage-blob-store.ts';

function setupTest() {
  // Accepts each connection and never answers it.
  const listener = Bun.listen({
    hostname: '127.0.0.1',
    port: 0,
    socket: { data: () => {} },
  });

  onTestFinished(() => {
    listener.stop(true);
  });

  return {
    store: createGarageBlobStore({
      endpoint: `http://127.0.0.1:${listener.port}`,
      region: 'garage',
      bucket: 'blobs',
      accessKeyID: 'GK0000000000000000000000ab',
      secretAccessKey: 'a-secret-for-a-store-that-never-answers',
      requestTimeoutMs: 50,
    }),
  };
}

test('it reports a write as unavailable when the store never answers', async () => {
  const ctx = setupTest();

  const written = await ctx.store.write(new TextEncoder().encode('the ferry timetable'));

  expect(written).toStrictEqual({ ok: false, failure: { reason: 'unavailable' } });
});

test('it reports a read as unavailable when the store never answers', async () => {
  const ctx = setupTest();

  const read = await ctx.store.read(
    toTagged<BlobHash>('2c8a2b0d3c3a4c0e8f6f1b0f0d8d9e7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e'),
  );

  expect(read).toStrictEqual({ ok: false, failure: { reason: 'unavailable' } });
});

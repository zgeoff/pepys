import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalFolderBlobStore } from './local-folder/create-local-folder-blob-store.ts';
import { readBlobStoreFixtures, runBlobStoreFixture } from './run-blob-store-fixture.ts';

async function setupTest() {
  const directory = await mkdtemp(join(tmpdir(), 'pepys-blobs-'));

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  return { store: createLocalFolderBlobStore(directory) };
}

test.each(readBlobStoreFixtures().map((fixture) => [fixture.title, fixture] as const))(
  'it %s, in a local folder',
  async (_title, fixture) => {
    const ctx = await setupTest();
    const returned = await runBlobStoreFixture(ctx.store, fixture);

    expect(returned).toStrictEqual(fixture.calls.map((call) => call.returns));
  },
);

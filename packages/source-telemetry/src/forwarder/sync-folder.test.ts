import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncFolder } from './sync-folder.ts';

async function setupTest() {
  const folder = await mkdtemp(join(tmpdir(), 'pepys-folder-'));

  onTestFinished(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  return { folder };
}

test('it resolves for a folder, and leaves its files in place', async () => {
  const ctx = await setupTest();

  await Bun.write(join(ctx.folder, 'positions.json'), '{}');

  await syncFolder(ctx.folder);

  const names = await readdir(ctx.folder);

  expect(names).toStrictEqual(['positions.json']);
});

test('it rejects for a folder that does not exist', async () => {
  const ctx = await setupTest();

  expect(syncFolder(join(ctx.folder, 'missing'))).rejects.toThrow();
});

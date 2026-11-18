import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSyncedFolder } from './create-synced-folder.ts';

async function setupTest() {
  const folder = await mkdtemp(join(tmpdir(), 'pepys-folder-'));

  onTestFinished(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  return {
    folder,
    readMode: async (path: string) => {
      const stats = await stat(path);

      return stats.mode & 0o777;
    },
  };
}

test('it makes the folder and each missing folder above it with the mode', async () => {
  const ctx = await setupTest();

  await createSyncedFolder(join(ctx.folder, 'state', 'spool'), 0o700);

  expect({
    state: await ctx.readMode(join(ctx.folder, 'state')),
    spool: await ctx.readMode(join(ctx.folder, 'state', 'spool')),
  }).toStrictEqual({ state: 0o700, spool: 0o700 });
});

test('it keeps the mode of a folder that exists', async () => {
  const ctx = await setupTest();

  await createSyncedFolder(join(ctx.folder, 'spool'), 0o750);
  await createSyncedFolder(join(ctx.folder, 'spool'), 0o700);

  const mode = await ctx.readMode(join(ctx.folder, 'spool'));

  expect(mode).toBe(0o750);
});

test('it rejects when a file has the name of a folder above', async () => {
  const ctx = await setupTest();

  await Bun.write(join(ctx.folder, 'state'), 'a file');

  expect(createSyncedFolder(join(ctx.folder, 'state', 'spool'), 0o700)).rejects.toThrow();
});

import { expect, onTestFinished, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
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

test('it makes a folder from a relative path under a folder that it cannot list', async () => {
  const ctx = await setupTest();

  const locked = join(ctx.folder, 'locked');

  await mkdir(join(locked, 'state'), { recursive: true });
  await chmod(locked, 0o300);

  const path = relative(process.cwd(), join(locked, 'state', 'spool'));

  const [made] = await Promise.allSettled([createSyncedFolder(path, 0o700)]);

  await chmod(locked, 0o700);

  expect(made.status).toBe('fulfilled');
});

test('it rejects when a file has the name of a folder above', async () => {
  const ctx = await setupTest();

  await Bun.write(join(ctx.folder, 'state'), 'a file');

  expect(createSyncedFolder(join(ctx.folder, 'state', 'spool'), 0o700)).rejects.toThrow();
});

test('it syncs every folder up to the root when the folders exist, since an earlier process can stop before its syncs', async () => {
  const ctx = await setupTest();

  const spool = join(ctx.folder, 'state', 'spool');

  await mkdir(spool, { recursive: true });

  const synced: string[] = [];

  await createSyncedFolder(spool, 0o700, (folder) => {
    synced.push(folder);

    return Promise.resolve();
  });

  expect(synced.slice(0, 3)).toStrictEqual([spool, join(ctx.folder, 'state'), ctx.folder]);
  expect(synced.at(-1)).toBe('/');
});

test('it syncs the folders above the first folder it makes', async () => {
  const ctx = await setupTest();

  const synced: string[] = [];

  await createSyncedFolder(join(ctx.folder, 'state', 'spool'), 0o700, (folder) => {
    synced.push(folder);

    return Promise.resolve();
  });

  expect(synced).toContain(ctx.folder);
  expect(synced.at(-1)).toBe('/');
});

test('it stops at a folder above that it cannot read', async () => {
  const ctx = await setupTest();

  const synced: string[] = [];

  await createSyncedFolder(join(ctx.folder, 'state', 'spool'), 0o700, (folder) => {
    if (folder === ctx.folder) {
      return Promise.reject(Object.assign(new Error('permission denied'), { code: 'EACCES' }));
    }

    synced.push(folder);

    return Promise.resolve();
  });

  expect(synced).toStrictEqual([join(ctx.folder, 'state', 'spool'), join(ctx.folder, 'state')]);
});

import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeSyncedFile } from './write-synced-file.ts';

async function setupTest() {
  const folder = await mkdtemp(join(tmpdir(), 'pepys-file-'));

  onTestFinished(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  return { path: join(folder, 'machine.json') };
}

test('it writes a new file with the text and the mode', async () => {
  const ctx = await setupTest();

  await writeSyncedFile(ctx.path, '{"id":"id-1"}\n', { flag: 'wx', mode: 0o600 });

  const stats = await stat(ctx.path);

  expect({ text: await readFile(ctx.path, 'utf8'), mode: stats.mode & 0o777 }).toStrictEqual({
    text: '{"id":"id-1"}\n',
    mode: 0o600,
  });
});

test('it replaces the text of a file that exists with the flag w', async () => {
  const ctx = await setupTest();

  await writeSyncedFile(ctx.path, 'a longer first text\n', { flag: 'w', mode: 0o600 });
  await writeSyncedFile(ctx.path, 'second\n', { flag: 'w', mode: 0o600 });

  const text = await readFile(ctx.path, 'utf8');

  expect(text).toBe('second\n');
});

test('it rejects, and keeps the file, for a file that exists with the flag wx', async () => {
  const ctx = await setupTest();

  await writeSyncedFile(ctx.path, 'first\n', { flag: 'wx', mode: 0o600 });

  const [second] = await Promise.allSettled([
    writeSyncedFile(ctx.path, 'second\n', { flag: 'wx', mode: 0o600 }),
  ]);

  expect({ second: second.status, text: await readFile(ctx.path, 'utf8') }).toStrictEqual({
    second: 'rejected',
    text: 'first\n',
  });
});

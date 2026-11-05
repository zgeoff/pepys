import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, readlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readOptionalText } from './read-optional-text.ts';
import { readRunPrefix } from './test-utils/read-run-prefix.ts';

async function setupTest() {
  const prefix = await readRunPrefix(readlink, process.pid);
  const directory = await mkdtemp(join(tmpdir(), `${prefix}optional-text-`));

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  return { directory };
}

test('it reads the text of a file that exists', async () => {
  const ctx = await setupTest();

  await Bun.write(join(ctx.directory, 'notes.txt'), 'first line\n');

  const text = await readOptionalText(join(ctx.directory, 'notes.txt'));

  expect(text).toBe('first line\n');
});

test.each([
  { kind: 'a missing file', path: 'missing.txt' },
  { kind: 'a path through a file', path: 'notes.txt/inner.txt' },
])('it reads undefined for $kind', async (row) => {
  const ctx = await setupTest();

  await Bun.write(join(ctx.directory, 'notes.txt'), 'first line\n');

  const text = await readOptionalText(join(ctx.directory, row.path));

  expect(text).toBeUndefined();
});

test('it throws when the path is a folder', async () => {
  const ctx = await setupTest();

  expect(readOptionalText(ctx.directory)).rejects.toThrow();
});

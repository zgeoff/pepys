import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSHA256 } from './read-sha256.ts';

async function setupTest() {
  const directory = await mkdtemp(join(tmpdir(), 'pepys-sha256-'));

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  return { directory };
}

test('it reads the sha256 of a file as lowercase hex', async () => {
  const ctx = await setupTest();

  const path = join(ctx.directory, 'greeting.txt');

  await Bun.write(path, 'hello\n');

  const sha256 = await readSHA256(path);

  expect(sha256).toBe('5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03');
});

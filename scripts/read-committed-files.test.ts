import { expect, onTestFinished, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCommittedFiles } from './read-committed-files.ts';

async function setupTest() {
  const root = await mkdtemp(join(tmpdir(), 'pepys-committed-'));

  onTestFinished(() => rm(root, { recursive: true, force: true }));

  return {
    root,
    writeFile: (path: string, content: string) => Bun.write(join(root, path), content),
    makeFolder: (path: string) => mkdir(join(root, path), { recursive: true }),
  };
}

test('it reads the committed text of a generated file', async () => {
  const ctx = await setupTest();

  await ctx.writeFile('gen/tide.sql', 'old sql');

  const committed = await readCommittedFiles(ctx.root, [{ path: 'gen/tide.sql', content: 'sql' }]);

  expect(committed).toStrictEqual(new Map([['gen/tide.sql', 'old sql']]));
});

test('it gives no text for a generated file that is missing', async () => {
  const ctx = await setupTest();
  const committed = await readCommittedFiles(ctx.root, [{ path: 'gen/tide.sql', content: 'sql' }]);

  expect(committed).toStrictEqual(new Map());
});

test('it gives no text for a generated file whose path is a folder', async () => {
  const ctx = await setupTest();

  await ctx.makeFolder('gen/tide.sql');

  const committed = await readCommittedFiles(ctx.root, [{ path: 'gen/tide.sql', content: 'sql' }]);

  expect(committed).toStrictEqual(new Map());
});

import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writePositions } from './write-positions.ts';

async function setupTest() {
  const folder = await mkdtemp(join(tmpdir(), 'pepys-spool-'));

  onTestFinished(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  return { folder };
}

test('#writePositions writes positions.json with mode 0600 and leaves no temporary file', async () => {
  const ctx = await setupTest();

  await writePositions(ctx.folder, { 'a-logs.jsonl': { offset: 3 } });

  const text = await readFile(join(ctx.folder, 'positions.json'), 'utf8');
  const stats = await stat(join(ctx.folder, 'positions.json'));
  const names = await readdir(ctx.folder);

  expect({ text, mode: stats.mode & 0o777, names }).toStrictEqual({
    text: '{"a-logs.jsonl":{"offset":3}}',
    mode: 0o600,
    names: ['positions.json'],
  });
});

test('#writePositions leaves one whole positions.json and no temporary file after two writes at once', async () => {
  const ctx = await setupTest();

  const written = await Promise.allSettled([
    writePositions(ctx.folder, { 'a-logs.jsonl': { offset: 3 } }),
    writePositions(ctx.folder, { 'a-logs.jsonl': { offset: 3 } }),
  ]);

  const text = await readFile(join(ctx.folder, 'positions.json'), 'utf8');
  const names = await readdir(ctx.folder);

  expect({ written: written.map((result) => result.status), text, names }).toStrictEqual({
    written: ['fulfilled', 'fulfilled'],
    text: '{"a-logs.jsonl":{"offset":3}}',
    names: ['positions.json'],
  });
});

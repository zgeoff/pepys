import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPositionsFile } from './create-positions-file.ts';
import { readPositions } from './read-positions.ts';
import { writePositions } from './write-positions.ts';

async function setupTest() {
  const folder = await mkdtemp(join(tmpdir(), 'pepys-spool-'));

  onTestFinished(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  return { folder };
}

test('#createPositionsFile makes an empty positions.json for a spool with no file', async () => {
  const ctx = await setupTest();

  await createPositionsFile(ctx.folder);

  const positions = await readPositions(ctx.folder);

  expect(positions).toStrictEqual({ ok: true, value: {} });
});

test('#createPositionsFile makes no positions.json while a spool file is there', async () => {
  const ctx = await setupTest();

  await Bun.write(join(ctx.folder, '2026-03-02-logs.jsonl'), '{}\n');

  await createPositionsFile(ctx.folder);

  const names = await readdir(ctx.folder);

  expect(names).toStrictEqual(['2026-03-02-logs.jsonl']);
});

test('#createPositionsFile leaves the positions that are there', async () => {
  const ctx = await setupTest();

  await writePositions(ctx.folder, { '2026-03-02-logs.jsonl': { offset: 4 } });
  await createPositionsFile(ctx.folder);

  const positions = await readPositions(ctx.folder);

  expect(positions).toStrictEqual({
    ok: true,
    value: { '2026-03-02-logs.jsonl': { offset: 4 } },
  });
});

test('#createPositionsFile leaves a positions.json that does not parse', async () => {
  const ctx = await setupTest();

  await Bun.write(join(ctx.folder, 'positions.json'), '{oops');

  await createPositionsFile(ctx.folder);

  const text = await Bun.file(join(ctx.folder, 'positions.json')).text();

  expect(text).toBe('{oops');
});

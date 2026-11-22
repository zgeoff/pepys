import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendFailedLine } from './append-failed-line.ts';
import { countFailedLines } from './count-failed-lines.ts';

async function setupTest() {
  const folder = await mkdtemp(join(tmpdir(), 'pepys-spool-'));

  onTestFinished(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  return { folder };
}

test('#countFailedLines counts the lines of every file under failed/', async () => {
  const ctx = await setupTest();

  const failed = { line: 'x', failed: { at: 'now', status: 400, reason: 'bad' } };

  await appendFailedLine(ctx.folder, '2026-03-01-logs.jsonl', failed);
  await appendFailedLine(ctx.folder, '2026-03-01-logs.jsonl', failed);
  await appendFailedLine(ctx.folder, '2026-03-02-logs.jsonl', failed);

  const count = await countFailedLines(ctx.folder);

  expect(count).toBe(3);
});

test('#countFailedLines returns 0 for a folder with no failed/ folder', async () => {
  const ctx = await setupTest();
  const count = await countFailedLines(ctx.folder);

  expect(count).toBe(0);
});

test('#countFailedLines leaves a file under failed/ that is not a spool file out of the count', async () => {
  const ctx = await setupTest();

  await Bun.write(join(ctx.folder, 'failed', 'notes.txt'), 'one\ntwo\n');

  const count = await countFailedLines(ctx.folder);

  expect(count).toBe(0);
});

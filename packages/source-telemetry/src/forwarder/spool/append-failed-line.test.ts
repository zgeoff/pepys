import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendFailedLine } from './append-failed-line.ts';

async function setupTest() {
  const folder = await mkdtemp(join(tmpdir(), 'pepys-spool-'));

  onTestFinished(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  return { folder };
}

test('#appendFailedLine appends one JSON line to the failed file of the spool file, with mode 0600', async () => {
  const ctx = await setupTest();

  const failed = { line: { field: 1 }, failed: { at: 'now', status: null, reason: 'bad' } };

  await appendFailedLine(ctx.folder, '2026-03-02-logs.jsonl', failed);
  await appendFailedLine(ctx.folder, '2026-03-02-logs.jsonl', failed);

  const path = join(ctx.folder, 'failed', '2026-03-02-logs.jsonl');

  const text = await readFile(path, 'utf8');
  const stats = await stat(path);

  expect({ text, mode: stats.mode & 0o777 }).toStrictEqual({
    text: `${JSON.stringify(failed)}\n${JSON.stringify(failed)}\n`,
    mode: 0o600,
  });
});

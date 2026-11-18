import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSpoolLine } from './read-spool-line.ts';

async function setupTest() {
  const folder = await mkdtemp(join(tmpdir(), 'pepys-spool-'));

  onTestFinished(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  const path = join(folder, '2026-03-02-logs.jsonl');

  return { path, write: (text: string) => Bun.write(path, text) };
}

test('#readSpoolLine reads the line at an offset and returns the offset after its line break', async () => {
  const ctx = await setupTest();

  await ctx.write('first\nsecond\n');

  const read = await readSpoolLine(ctx.path, 6, false);

  expect(read).toStrictEqual({
    kind: 'line',
    text: 'second',
    nextOffset: 13,
  });
});

test('#readSpoolLine counts the offset in bytes, not characters', async () => {
  const ctx = await setupTest();

  await ctx.write('héllo\nnext\n');

  const read = await readSpoolLine(ctx.path, 0, false);

  expect(read).toStrictEqual({
    kind: 'line',
    text: 'héllo',
    nextOffset: 7,
  });
});

test('#readSpoolLine reads a line longer than one chunk', async () => {
  const ctx = await setupTest();

  const long = 'x'.repeat(3_000_000);

  await ctx.write(`${long}\n`);

  const read = await readSpoolLine(ctx.path, 0, false);

  expect(read).toStrictEqual({
    kind: 'line',
    text: long,
    nextOffset: 3_000_001,
  });
});

test('#readSpoolLine holds a last line with no line break unless it accepts a partial line', async () => {
  const ctx = await setupTest();

  await ctx.write('first\npartial');

  const held = await readSpoolLine(ctx.path, 6, false);
  const accepted = await readSpoolLine(ctx.path, 6, true);

  expect([held, accepted]).toStrictEqual([
    { kind: 'none' },
    { kind: 'line', text: 'partial', nextOffset: 13 },
  ]);
});

test('#readSpoolLine returns none at the end of the file', async () => {
  const ctx = await setupTest();

  await ctx.write('first\n');

  const read = await readSpoolLine(ctx.path, 6, true);

  expect(read).toStrictEqual({ kind: 'none' });
});

test('#readSpoolLine returns past-end for an offset beyond the file', async () => {
  const ctx = await setupTest();

  await ctx.write('first\n');

  const read = await readSpoolLine(ctx.path, 7, true);

  expect(read).toStrictEqual({ kind: 'past-end' });
});

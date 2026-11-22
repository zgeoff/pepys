import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSpoolAppender } from './create-spool-appender.ts';

async function setupTest() {
  const folder = await mkdtemp(join(tmpdir(), 'pepys-spool-'));

  onTestFinished(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  const clock = { nowMs: Date.parse('2026-03-02T23:59:59Z') };
  const spoolDir = join(folder, 'spool');

  return {
    clock,
    spoolDir,
    append: createSpoolAppender({ folder: spoolDir, now: () => clock.nowMs }),
    readFile: (name: string) => readFile(join(spoolDir, name), 'utf8'),
    readNames: async () => {
      const names = await readdir(spoolDir);

      return names.toSorted();
    },
    readMode: async (name: string) => {
      const stats = await stat(join(spoolDir, name));

      return stats.mode & 0o777;
    },
  };
}

test('#createSpoolAppender appends to the file of the current UTC day, in a file of mode 0600', async () => {
  const ctx = await setupTest();

  await ctx.append('one\n');

  ctx.clock.nowMs += 2000;

  await ctx.append('two\n');

  expect({
    files: await ctx.readNames(),
    first: await ctx.readFile('2026-03-02-logs.jsonl'),
    second: await ctx.readFile('2026-03-03-logs.jsonl'),
    mode: await ctx.readMode('2026-03-02-logs.jsonl'),
  }).toStrictEqual({
    files: ['2026-03-02-logs.jsonl', '2026-03-03-logs.jsonl'],
    first: 'one\n',
    second: 'two\n',
    mode: 0o600,
  });
});

test('#createSpoolAppender starts a new line after a partial last line', async () => {
  const ctx = await setupTest();

  await Bun.write(join(ctx.spoolDir, '2026-03-02-logs.jsonl'), '{"half');
  await ctx.append('whole\n');

  const text = await ctx.readFile('2026-03-02-logs.jsonl');

  expect(text).toBe('{"half\nwhole\n');
});

test('#createSpoolAppender keeps every line of concurrent appends whole', async () => {
  const ctx = await setupTest();

  const lines = Array.from({ length: 20 }, (_, index) => `line-${index}\n`);

  await Promise.all(lines.map((line) => ctx.append(line)));

  const text = await ctx.readFile('2026-03-02-logs.jsonl');

  expect(text.split('\n').toSorted()).toStrictEqual(
    ['', ...lines.map((line) => line.trim())].toSorted(),
  );
});

test('#createSpoolAppender rejects when the spool folder cannot be made', async () => {
  const ctx = await setupTest();

  const blocked = createSpoolAppender({
    folder: join(ctx.spoolDir, '2026-03-02-logs.jsonl', 'inside'),
    now: () => ctx.clock.nowMs,
  });

  await ctx.append('first\n');

  expect(blocked('second\n')).rejects.toThrow();
});

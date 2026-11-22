import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPositions } from './read-positions.ts';
import { writePositions } from './write-positions.ts';

async function setupTest() {
  const folder = await mkdtemp(join(tmpdir(), 'pepys-spool-'));

  onTestFinished(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  return {
    folder,
    writePositionsText: (text: string) => Bun.write(join(folder, 'positions.json'), text),
  };
}

test('#readPositions reads what #writePositions wrote', async () => {
  const ctx = await setupTest();

  await writePositions(ctx.folder, { '2026-03-02-logs.jsonl': { offset: 12, sentAt: 'x' } });

  const positions = await readPositions(ctx.folder);

  expect(positions).toStrictEqual({
    ok: true,
    value: { '2026-03-02-logs.jsonl': { offset: 12, sentAt: 'x' } },
  });
});

test('#readPositions returns no position for a folder with no positions.json', async () => {
  const ctx = await setupTest();
  const positions = await readPositions(ctx.folder);

  expect(positions).toStrictEqual({ ok: true, value: {} });
});

test.each([
  ['text that is no JSON', '{oops'],
  ['a negative offset', '{"a-logs.jsonl":{"offset":-1}}'],
  ['an entry with no offset', '{"a-logs.jsonl":{}}'],
])('#readPositions fails on %s', async (_name, text) => {
  const ctx = await setupTest();

  await ctx.writePositionsText(text);

  const positions = await readPositions(ctx.folder);

  expect(positions.ok).toBeFalse();
});

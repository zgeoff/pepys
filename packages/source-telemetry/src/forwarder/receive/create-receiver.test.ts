import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createLogger } from '@pepys/kit';
import type { SendState } from '../send/types.ts';
import { createSpoolAppender } from '../spool/create-spool-appender.ts';
import { createReceiver } from './create-receiver.ts';

async function setupTest() {
  const folder = await mkdtemp(join(tmpdir(), 'pepys-receiver-'));

  onTestFinished(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  const spoolDir = join(folder, 'spool');
  const state: { current: SendState } = { current: { send: 'off', failed: 0 } };
  const stored = { count: 0 };
  const lines: string[] = [];

  const createReceiverAt = (appendFolder: string) =>
    createReceiver({
      append: createSpoolAppender({
        folder: appendFolder,
        now: () => Date.parse('2026-03-02T10:15:00Z'),
      }),
      readState: () => state.current,
      now: () => Date.parse('2026-03-02T10:15:00Z'),
      logger: createLogger({ write: (line) => lines.push(line) }),
      onStored: () => {
        stored.count += 1;
      },
    });

  return {
    folder,
    readAnswer: async (response: Response) => ({
      status: response.status,
      body: await response.json(),
    }),
    spoolDir,
    state,
    stored,
    lines,
    receive: createReceiverAt(spoolDir),
    createReceiverAt,
    readSpool: async () => {
      const names = await readdir(spoolDir).catch(() => []);

      return Promise.all(names.map((name) => readFile(join(spoolDir, name), 'utf8')));
    },
    post: (path: string, body: string | Uint8Array, headers: Record<string, string>) =>
      new Request(`http://127.0.0.1:4318${path}`, { method: 'POST', body, headers }),
  };
}

test('it stores a log export as one line with the receipt time, the user agent and the body, and answers 200 {}', async () => {
  const ctx = await setupTest();

  const answer = await ctx.receive(
    ctx.post('/v1/logs', '{"resourceLogs":[]}', {
      'content-type': 'application/json',
      'user-agent': 'codex/1.0',
    }),
  );

  expect({ answer: await ctx.readAnswer(answer), spool: await ctx.readSpool() }).toStrictEqual({
    answer: { status: 200, body: {} },
    spool: [
      '{"received":"2026-03-02T10:15:00.000Z","path":"/v1/logs","ua":"codex/1.0","body":{"resourceLogs":[]}}\n',
    ],
  });
});

test('it unpacks a gzip body before it stores the export', async () => {
  const ctx = await setupTest();

  await ctx.receive(
    ctx.post('/v1/logs', gzipSync('{"resourceLogs":[1]}'), {
      'content-type': 'application/json; charset=utf-8',
      'content-encoding': 'gzip',
    }),
  );

  const spool = await ctx.readSpool();

  expect(spool).toStrictEqual([
    '{"received":"2026-03-02T10:15:00.000Z","path":"/v1/logs","ua":null,"body":{"resourceLogs":[1]}}\n',
  ]);
});

test.each(['/v1/metrics', '/v1/traces'])(
  'it answers 200 {} to %s and stores nothing',
  async (path) => {
    const ctx = await setupTest();

    const answer = await ctx.receive(
      ctx.post(path, '{"resourceMetrics":[]}', { 'content-type': 'application/json' }),
    );

    expect({
      answer: await ctx.readAnswer(answer),
      spool: await ctx.readSpool(),
      stored: ctx.stored.count,
    }).toStrictEqual({ answer: { status: 200, body: {} }, spool: [], stored: 0 });
  },
);

test.each([
  ['a protobuf body', 'application/x-protobuf'],
  ['no content type', ''],
])('it answers 415 to %s and stores nothing', async (_name, contentType) => {
  const ctx = await setupTest();

  const headers: Record<string, string> = contentType === '' ? {} : { 'content-type': contentType };

  const answer = await ctx.receive(ctx.post('/v1/logs', '{}', headers));

  expect({ status: answer.status, spool: await ctx.readSpool() }).toStrictEqual({
    status: 415,
    spool: [],
  });
});

test.each([
  ['a body that is no JSON', 'oops', {}],
  ['a corrupt gzip body', 'oops', { 'content-encoding': 'gzip' }],
])('it answers 400 to %s and stores nothing', async (_name, body, extra) => {
  const ctx = await setupTest();

  const answer = await ctx.receive(
    ctx.post('/v1/logs', body, { 'content-type': 'application/json', ...extra }),
  );

  expect({ status: answer.status, spool: await ctx.readSpool() }).toStrictEqual({
    status: 400,
    spool: [],
  });
});

test('it answers 415 before 400 to a body that is both the wrong type and no JSON', async () => {
  const ctx = await setupTest();

  const answer = await ctx.receive(
    ctx.post('/v1/metrics', 'oops', { 'content-type': 'text/plain' }),
  );

  expect(answer.status).toBe(415);
});

test('it answers 503 and stores nothing when the append fails, and logs the failure', async () => {
  const ctx = await setupTest();

  await Bun.write(join(ctx.folder, 'blocker'), 'a file where the spool folder should be');

  const receive = ctx.createReceiverAt(join(ctx.folder, 'blocker', 'spool'));

  const answer = await receive(ctx.post('/v1/logs', '{}', { 'content-type': 'application/json' }));

  expect({
    status: answer.status,
    stored: ctx.stored.count,
    logged: ctx.lines.some((line) => line.includes('could not append')),
  }).toStrictEqual({ status: 503, stored: 0, logged: true });
});

test('it tells the send loop about each stored export', async () => {
  const ctx = await setupTest();

  await ctx.receive(ctx.post('/v1/logs', '{}', { 'content-type': 'application/json' }));

  expect(ctx.stored.count).toBe(1);
});

test.each([
  [{ send: 'off', failed: 0 }, 200],
  [{ send: 'sending', failed: 0 }, 200],
  [{ send: 'waiting', status: 503, since: '2026-03-02T10:15:00Z', failed: 2 }, 200],
  [{ send: 'stopped', status: 401, since: '2026-03-02T10:15:00Z', failed: 2 }, 503],
] as const)(
  'it answers GET /health with the send state %p and the status %p',
  async (state, status) => {
    const ctx = await setupTest();

    ctx.state.current = state;

    const answer = await ctx.receive(new Request('http://127.0.0.1:4318/health'));
    const read = await ctx.readAnswer(answer);

    expect(read).toStrictEqual({ status, body: state });
  },
);

test('it answers 404 to another path and 405 to a GET of an export path', async () => {
  const ctx = await setupTest();
  const other = await ctx.receive(ctx.post('/other', '{}', { 'content-type': 'application/json' }));
  const get = await ctx.receive(new Request('http://127.0.0.1:4318/v1/logs'));

  expect([other.status, get.status]).toStrictEqual([404, 405]);
});

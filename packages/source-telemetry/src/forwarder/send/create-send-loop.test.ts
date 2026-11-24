import { expect, onTestFinished, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIngest, createMemoryFactLog, readImpIdentitySenderProof } from '@pepys/ingest';
import type { FactLog } from '@pepys/ingest';
import { checkDeployment, createLogger } from '@pepys/kit';
import type { StreamName, StreamOffset } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import invariant from 'tiny-invariant';
import { z } from 'zod';
import { telemetryPlugin } from '../../telemetry-plugin.ts';
import { buildLogsExport } from '../../test-utils/build-logs-export.ts';
import { buildTrustDocument } from '../identity/build-trust-document.ts';
import { createIdentity } from '../identity/create-identity.ts';
import { signIdentityToken } from '../identity/sign-identity-token.ts';
import type { Identity } from '../identity/types.ts';
import { createReceiver } from '../receive/create-receiver.ts';
import { buildSpoolLine } from '../spool/build-spool-line.ts';
import { createSpoolAppender } from '../spool/create-spool-appender.ts';
import { readPositions } from '../spool/read-positions.ts';
import { writePositions } from '../spool/write-positions.ts';
import { createSendLoop } from './create-send-loop.ts';

async function setupTest() {
  const audience = 'forwarder.pepys.test';
  const startMs = Date.parse('2026-03-02T10:00:00Z');
  const hourMs = 3_600_000;
  const today = '2026-03-02-logs.jsonl';

  const folder = await mkdtemp(join(tmpdir(), 'pepys-forwarder-'));

  onTestFinished(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  const spoolDir = join(folder, 'spool');
  const trustDir = join(folder, 'trust');

  await mkdir(trustDir);
  await mkdir(spoolDir);

  // what `run` makes for a spool with no file yet
  await writePositions(spoolDir, {});

  const created = await createIdentity({
    folder: join(folder, 'identity'),
    issuer: 'study-pc',
    randomID: () => '5f0c8a52-1d7e-4b3a-9c1f-2e6d7a8b9c10',
  });

  invariant(created.ok, 'the identity is made');

  await Bun.write(
    join(trustDir, 'study-pc.json'),
    JSON.stringify(buildTrustDocument(created.value)),
  );

  const clock = { nowMs: startMs };
  const logLines: string[] = [];
  const logger = createLogger({ write: (line) => logLines.push(line) });

  const checked = checkDeployment({
    name: 'harbour',
    plugins: [telemetryPlugin],
  });

  invariant(checked.ok, 'the telemetry deployment passes its check');

  const stream = toTagged<StreamName>('facts.telemetry.log_record');
  const memoryLog = createMemoryFactLog([stream]);
  const fault: { mode: 'none' | 'unavailable' | 'refuse' } = { mode: 'none' };

  // a 503 comes from a log that cannot be read, and a 500 from a log that refuses the batch
  const log: FactLog = {
    read: (...args) => memoryLog.read(...args),
    readTail: (...args) => {
      if (fault.mode === 'unavailable') {
        throw new Error('the log is down');
      }

      return memoryLog.readTail(...args);
    },
    appendBatch: (...args) =>
      fault.mode === 'refuse'
        ? Promise.resolve({ kind: 'rejected', reason: 'too-large' })
        : memoryLog.appendBatch(...args),
  };

  const senderProof = await readImpIdentitySenderProof({
    sources: checked.value.sources,
    environment: {
      PEPYS_TELEMETRY_FORWARDER_AUDIENCE: audience,
      PEPYS_TELEMETRY_FORWARDER_ISSUERS: trustDir,
    },
    now: () => clock.nowMs,
    logger,
  });

  invariant(senderProof.ok, 'the trust folder loads');

  const ingest = createIngest({
    deployment: checked.value,
    secrets: { PEPYS_TELEMETRY_TOKEN: 'tide-key' },
    log,
    senderProof: senderProof.value,
    appendRetry: { maxAttempts: 1, retryDelayMs: 0 },
    now: () => clock.nowMs,
    logger,
  });

  const requests: {
    body: string;
    token: string | null;
    url: string;
    redirect: string;
  }[] = [];

  const waits: number[] = [];
  const unusedStores = { count: 0 };

  const stopper = new AbortController();

  const requestSeen = Promise.withResolvers<void>();

  // `limit` stops a run after that many sleeps, and `hold` makes a sleep last until the stop
  const sleeper = {
    limit: Number.POSITIVE_INFINITY,
    hold: false,
    entered: Promise.withResolvers<void>(),
  };

  const signWith = (identity: Identity) => () =>
    signIdentityToken({
      identity,
      audience,
      nowMs: clock.nowMs,
      jti: randomUUID(),
    });

  const createLoop = (signToken: () => Promise<string>, maxBytesPerSecond = 1_000_000_000) =>
    createSendLoop({
      folder: spoolDir,
      ingestURL: 'http://ingest.test',
      signToken,
      post: async (request) => {
        requestSeen.resolve();

        requests.push({
          body: await request.clone().text(),
          token: request.headers.get('imp-identity'),
          url: request.url,
          redirect: request.redirect,
        });

        return ingest.handleRequest(request);
      },
      now: () => clock.nowMs,
      sleep: (waitMs, signal) => {
        waits.push(waitMs);
        sleeper.entered.resolve();

        if (waits.length >= sleeper.limit) {
          stopper.abort();
        }

        if (!sleeper.hold || signal.aborted) {
          return Promise.resolve();
        }

        return new Promise<void>((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              resolve();
            },
            { once: true },
          );
        });
      },
      logger,
      failedCount: 0,
      maxBytesPerSecond,
      requestTimeoutMs: 1000,
      pollMs: 1000,
    });

  return {
    audience,
    startMs,
    hourMs,
    today,
    spoolDir,
    identity: created.value,
    identityDir: join(folder, 'identity'),
    clock,
    fault,
    requests,
    waits,
    sleeper,
    stopper,
    requestSeen,
    logLines,
    signWith,
    createLoop,
    createStranger: async () => {
      const stranger = await createIdentity({
        folder: join(folder, 'stranger'),
        issuer: 'study-pc',
        randomID: () => '5f0c8a52-1d7e-4b3a-9c1f-2e6d7a8b9c10',
      });

      invariant(stranger.ok, 'the stranger identity is made');

      return stranger.value;
    },
    writeExport: async (atMs: number, turn: string) => {
      const body = buildLogsExport('codex', { 'atc.session.id': 's-9' }, [
        {
          'event.name': 'codex.turn_cost',
          'event.timestamp': '2026-11-11T02:21:30.000Z',
          'turn.id': turn,
        },
      ]);

      const text = buildSpoolLine({ nowMs: atMs, userAgent: 'codex', body });

      await createSpoolAppender({ folder: spoolDir, now: () => atMs })(text);

      return text;
    },
    writeRawLine: async (atMs: number, text: string) => {
      await createSpoolAppender({ folder: spoolDir, now: () => atMs })(text);
    },
    readStoredIDs: async () => {
      const read = await memoryLog.read(stream, toTagged<StreamOffset>(0), 100);

      invariant(read.ok, 'the stream exists');

      return read.value.map((item): string => item.fact.id);
    },
    readPositionOffset: async (name: string) => {
      const positions = await readPositions(spoolDir);

      invariant(positions.ok, 'positions.json parses');

      return positions.value[name]?.offset ?? 0;
    },
    readFailedLines: async (name: string) => {
      const text = await readFile(join(spoolDir, 'failed', name), 'utf8');

      return text
        .split('\n')
        .filter((line) => line !== '')
        .map((line): unknown => JSON.parse(line));
    },
    readSpoolNames: async () => {
      const names = await readdir(spoolDir);

      return names.toSorted();
    },
    readHealth: async (loop: ReturnType<typeof createLoop>) => {
      const answer = await createReceiver({
        append: () => Promise.resolve(),
        readState: loop.readState,
        now: () => clock.nowMs,
        logger,
        onStored: () => {
          unusedStores.count += 1;
        },
      })(new Request('http://forwarder.test/health'));

      return { status: answer.status, body: await answer.json() };
    },
    readKeyScalars: async () => {
      const texts = await Promise.all([
        readFile(join(folder, 'identity', 'private-key.json'), 'utf8'),
        readFile(join(folder, 'stranger', 'private-key.json'), 'utf8'),
      ]);

      return texts.map((text) => {
        const key = z.record(z.string(), z.string()).parse(JSON.parse(text));

        return key['d'] ?? 'missing';
      });
    },
    readSize: async (name: string) => {
      const stats = await stat(join(spoolDir, name));

      return stats.size;
    },
  };
}

test('it leaves one copy of each fact when an export is sent twice inside the hour', async () => {
  const ctx = await setupTest();

  const loop = ctx.createLoop(ctx.signWith(ctx.identity));

  await ctx.writeExport(ctx.clock.nowMs, 'turn-1');
  await ctx.writeExport(ctx.clock.nowMs, 'turn-1');
  await loop.step();
  await loop.step();

  const stored = await ctx.readStoredIDs();

  expect(stored).toStrictEqual(['event:telemetry:codex.turn_cost:turn-1']);
});

test('it leaves two copies of each fact, with no new fact ID, when an export is sent again after the hour', async () => {
  const ctx = await setupTest();

  const loop = ctx.createLoop(ctx.signWith(ctx.identity));

  await ctx.writeExport(ctx.clock.nowMs, 'turn-1');
  await ctx.writeExport(ctx.clock.nowMs, 'turn-1');
  await loop.step();

  ctx.clock.nowMs += ctx.hourMs + 1;

  await loop.step();

  const stored = await ctx.readStoredIDs();

  expect(stored).toStrictEqual([
    'event:telemetry:codex.turn_cost:turn-1',
    'event:telemetry:codex.turn_cost:turn-1',
  ]);
});

test('it moves the position past an export once after two 503 answers and a 200', async () => {
  const ctx = await setupTest();

  const loop = ctx.createLoop(ctx.signWith(ctx.identity));

  const text = await ctx.writeExport(ctx.clock.nowMs, 'turn-1');

  ctx.fault.mode = 'unavailable';

  const first = await loop.step();
  const second = await loop.step();

  ctx.fault.mode = 'none';

  await loop.step();

  expect({
    waits: [first, second],
    offset: await ctx.readPositionOffset(ctx.today),
    stored: await ctx.readStoredIDs(),
    spool: await ctx.readSpoolNames(),
    state: loop.readState(),
  }).toStrictEqual({
    waits: [1000, 2000],
    offset: Buffer.byteLength(text),
    stored: ['event:telemetry:codex.turn_cost:turn-1'],
    spool: [ctx.today, 'positions.json'],
    state: { send: 'sending', failed: 0 },
  });
});

test('it stops on a 401 from a key that is not in the trust document, and GET /health answers 503', async () => {
  const ctx = await setupTest();
  const stranger = await ctx.createStranger();

  const loop = ctx.createLoop(ctx.signWith(stranger));

  await ctx.writeExport(ctx.clock.nowMs, 'turn-1');

  const wait = await loop.step();

  expect({
    wait,
    offset: await ctx.readPositionOffset(ctx.today),
    health: await ctx.readHealth(loop),
  }).toStrictEqual({
    wait: 900_000,
    offset: 0,
    health: {
      status: 503,
      body: {
        send: 'stopped',
        status: 401,
        since: '2026-03-02T10:00:00.000Z',
        failed: 0,
      },
    },
  });
});

test('it moves the position on and answers GET /health 200 when a stopped loop gets a 200', async () => {
  const ctx = await setupTest();
  const stranger = await ctx.createStranger();

  const signers = { current: ctx.signWith(stranger) };
  const loop = ctx.createLoop(() => signers.current());

  await ctx.writeExport(ctx.clock.nowMs, 'turn-1');
  await loop.step();

  signers.current = ctx.signWith(ctx.identity);

  await loop.step();

  expect({
    offset: await ctx.readPositionOffset(ctx.today),
    health: await ctx.readHealth(loop),
  }).toStrictEqual({
    offset: await ctx.readSize(ctx.today),
    health: { status: 200, body: { send: 'sending', failed: 0 } },
  });
});

test('it keeps a line through three 500 answers, then moves it to failed on the fourth and sends the next line', async () => {
  const ctx = await setupTest();

  const loop = ctx.createLoop(ctx.signWith(ctx.identity));

  const first = await ctx.writeExport(ctx.clock.nowMs, 'turn-1');

  await ctx.writeExport(ctx.clock.nowMs, 'turn-2');

  ctx.fault.mode = 'refuse';

  await loop.step();
  await loop.step();
  await loop.step();

  const afterThree = {
    offset: await ctx.readPositionOffset(ctx.today),
    state: loop.readState(),
  };

  await loop.step();

  const afterFourth = {
    state: loop.readState(),
    health: await ctx.readHealth(loop),
  };

  ctx.fault.mode = 'none';

  await loop.step();

  expect({
    afterThree,
    afterFourth,
    offset: await ctx.readPositionOffset(ctx.today),
    failed: await ctx.readFailedLines(ctx.today),
    stored: await ctx.readStoredIDs(),
    state: loop.readState(),
  }).toStrictEqual({
    afterThree: {
      offset: 0,
      state: {
        send: 'stopped',
        status: 500,
        since: '2026-03-02T10:00:00.000Z',
        failed: 0,
      },
    },
    afterFourth: {
      state: { send: 'sending', failed: 1 },
      health: { status: 200, body: { send: 'sending', failed: 1 } },
    },
    offset: await ctx.readSize(ctx.today),
    failed: [
      {
        line: z.unknown().parse(JSON.parse(first)),
        failed: {
          at: '2026-03-02T10:00:00.000Z',
          status: 500,
          reason: 'the log refused the batch',
        },
      },
    ],
    stored: ['event:telemetry:codex.turn_cost:turn-2'],
    state: { send: 'sending', failed: 1 },
  });
});

test('it answers GET /health 200 right after the last pending line moves to failed on the fourth 500', async () => {
  const ctx = await setupTest();

  const loop = ctx.createLoop(ctx.signWith(ctx.identity));

  await ctx.writeExport(ctx.clock.nowMs, 'turn-1');

  ctx.fault.mode = 'refuse';

  await loop.step();
  await loop.step();
  await loop.step();
  await loop.step();

  expect({
    offset: await ctx.readPositionOffset(ctx.today),
    health: await ctx.readHealth(loop),
  }).toStrictEqual({
    offset: await ctx.readSize(ctx.today),
    health: { status: 200, body: { send: 'sending', failed: 1 } },
  });
});

test('it sends from the saved position after a restart, and sends no earlier line', async () => {
  const ctx = await setupTest();

  const before = ctx.createLoop(ctx.signWith(ctx.identity));

  const lines = [
    await ctx.writeExport(ctx.clock.nowMs, 'turn-1'),
    await ctx.writeExport(ctx.clock.nowMs, 'turn-2'),
    await ctx.writeExport(ctx.clock.nowMs, 'turn-3'),
  ];

  await before.step();
  await before.step();

  const after = ctx.createLoop(ctx.signWith(ctx.identity));

  await after.step();

  const bodies = ctx.requests.map((request) => request.body);

  expect(bodies).toStrictEqual(
    lines.map((line) =>
      JSON.stringify(z.object({ body: z.unknown() }).parse(JSON.parse(line)).body),
    ),
  );
});

test('it moves a line that gets a 400 to failed, sends the next line, and counts one failed line in GET /health', async () => {
  const ctx = await setupTest();

  const loop = ctx.createLoop(ctx.signWith(ctx.identity));

  await ctx.writeRawLine(
    ctx.clock.nowMs,
    `${JSON.stringify({ received: '2026-03-02T10:00:00.000Z', path: '/v1/logs', ua: null, body: { resourceLogs: 'none' } })}\n`,
  );

  await ctx.writeExport(ctx.clock.nowMs, 'turn-1');
  await loop.step();
  await loop.step();

  const failed = await ctx.readFailedLines(ctx.today);

  expect({
    failed,
    stored: await ctx.readStoredIDs(),
    health: await ctx.readHealth(loop),
  }).toStrictEqual({
    failed: [
      {
        line: {
          received: '2026-03-02T10:00:00.000Z',
          path: '/v1/logs',
          ua: null,
          body: { resourceLogs: 'none' },
        },
        failed: {
          at: '2026-03-02T10:00:00.000Z',
          status: 400,
          reason: 'the body is no OTLP logs export',
        },
      },
    ],
    stored: ['event:telemetry:codex.turn_cost:turn-1'],
    health: { status: 200, body: { send: 'sending', failed: 1 } },
  });
});

test('it sends a line of the current day before the next line of an older file', async () => {
  const ctx = await setupTest();

  const loop = ctx.createLoop(ctx.signWith(ctx.identity));
  const yesterday = ctx.clock.nowMs - 24 * ctx.hourMs;

  await ctx.writeExport(yesterday, 'old-1');
  await ctx.writeExport(yesterday, 'old-2');
  await loop.step();
  await ctx.writeExport(ctx.clock.nowMs, 'new-1');
  await loop.step();
  await loop.step();

  const stored = await ctx.readStoredIDs();

  expect(stored).toStrictEqual([
    'event:telemetry:codex.turn_cost:old-1',
    'event:telemetry:codex.turn_cost:new-1',
    'event:telemetry:codex.turn_cost:old-2',
  ]);
});

test('it deletes a file sent 7 days ago, and keeps a file sent 6 days ago', async () => {
  const ctx = await setupTest();

  const loop = ctx.createLoop(ctx.signWith(ctx.identity));
  const dayMs = 24 * ctx.hourMs;
  const sevenDays = ctx.clock.nowMs - 7 * dayMs;
  const sixDays = ctx.clock.nowMs - 6 * dayMs;

  await ctx.writeExport(ctx.clock.nowMs - 20 * dayMs, 'a');
  await ctx.writeExport(ctx.clock.nowMs - 19 * dayMs, 'b');

  await writePositions(ctx.spoolDir, {
    '2026-02-10-logs.jsonl': {
      offset: await ctx.readSize('2026-02-10-logs.jsonl'),
      sentAt: new Date(sevenDays).toISOString(),
    },
    '2026-02-11-logs.jsonl': {
      offset: await ctx.readSize('2026-02-11-logs.jsonl'),
      sentAt: new Date(sixDays).toISOString(),
    },
  });

  const wait = await loop.step();

  expect({ wait, files: await ctx.readSpoolNames() }).toStrictEqual({
    wait: null,
    files: ['2026-02-11-logs.jsonl', 'positions.json'],
  });
});

test('it sets sentAt the first time it finds an earlier file with no unsent line', async () => {
  const ctx = await setupTest();

  const loop = ctx.createLoop(ctx.signWith(ctx.identity));

  await ctx.writeExport(ctx.clock.nowMs - 24 * ctx.hourMs, 'old-1');
  await loop.step();
  await loop.step();

  const positions = await readPositions(ctx.spoolDir);

  expect(positions).toStrictEqual({
    ok: true,
    value: {
      '2026-03-01-logs.jsonl': {
        offset: await ctx.readSize('2026-03-01-logs.jsonl'),
        sentAt: '2026-03-02T10:00:00.000Z',
      },
    },
  });
});

test('it keeps the position of a line that gets a 400 when the failed line cannot be written', async () => {
  const ctx = await setupTest();

  const loop = ctx.createLoop(ctx.signWith(ctx.identity));

  await ctx.writeRawLine(
    ctx.clock.nowMs,
    `${JSON.stringify({ received: '2026-03-02T10:00:00.000Z', path: '/v1/logs', ua: null, body: { resourceLogs: 'none' } })}\n`,
  );

  await Bun.write(join(ctx.spoolDir, 'failed'), 'a file where the failed folder goes');

  const [stepped] = await Promise.allSettled([loop.step()]);

  expect({
    stepped: stepped.status,
    requests: ctx.requests.length,
    offset: await ctx.readPositionOffset(ctx.today),
    health: await ctx.readHealth(loop),
  }).toStrictEqual({
    stepped: 'rejected',
    requests: 1,
    offset: 0,
    health: { status: 200, body: { send: 'sending', failed: 0 } },
  });
});

test('it sends nothing and stops when positions.json does not parse', async () => {
  const ctx = await setupTest();

  const loop = ctx.createLoop(ctx.signWith(ctx.identity));

  await ctx.writeExport(ctx.clock.nowMs, 'turn-1');
  await Bun.write(join(ctx.spoolDir, 'positions.json'), '{not json');

  const wait = await loop.step();

  expect({
    wait,
    requests: ctx.requests.length,
    state: loop.readState(),
  }).toStrictEqual({
    wait: 900_000,
    requests: 0,
    state: {
      send: 'stopped',
      status: null,
      since: '2026-03-02T10:00:00.000Z',
      failed: 0,
    },
  });
});

test('it sends nothing and stops when a position is past the end of its file', async () => {
  const ctx = await setupTest();

  const loop = ctx.createLoop(ctx.signWith(ctx.identity));

  await ctx.writeExport(ctx.clock.nowMs, 'turn-1');

  await writePositions(ctx.spoolDir, { [ctx.today]: { offset: 1_000_000 } });

  const wait = await loop.step();

  expect({
    wait,
    requests: ctx.requests.length,
    state: loop.readState(),
  }).toStrictEqual({
    wait: 900_000,
    requests: 0,
    state: {
      send: 'stopped',
      status: null,
      since: '2026-03-02T10:00:00.000Z',
      failed: 0,
    },
  });
});

test('it moves each line that it does not send to failed with a null status, and sends no request for it', async () => {
  const ctx = await setupTest();

  const loop = ctx.createLoop(ctx.signWith(ctx.identity));

  await ctx.writeRawLine(ctx.clock.nowMs, 'not json at all\n');
  await ctx.writeRawLine(ctx.clock.nowMs, '{"path":"/v1/metrics","body":{}}\n');
  await loop.step();
  await loop.step();

  expect({
    requests: ctx.requests.length,
    failed: await ctx.readFailedLines(ctx.today),
    state: loop.readState(),
  }).toStrictEqual({
    requests: 0,
    failed: [
      {
        line: 'not json at all',
        failed: {
          at: '2026-03-02T10:00:00.000Z',
          status: null,
          reason: 'the line does not parse as JSON',
        },
      },
      {
        line: { path: '/v1/metrics', body: {} },
        failed: {
          at: '2026-03-02T10:00:00.000Z',
          status: null,
          reason: 'the line has no path /v1/logs',
        },
      },
    ],
    state: { send: 'sending', failed: 2 },
  });
});

test('it holds a last line with no line break in the newest file', async () => {
  const ctx = await setupTest();

  const loop = ctx.createLoop(ctx.signWith(ctx.identity));

  const text = await ctx.writeExport(ctx.clock.nowMs, 'turn-1');

  await Bun.write(join(ctx.spoolDir, ctx.today), text.trimEnd());

  const wait = await loop.step();

  expect({ wait, requests: ctx.requests.length }).toStrictEqual({
    wait: null,
    requests: 0,
  });
});

test('it sends a last line with no line break in an older file', async () => {
  const ctx = await setupTest();

  const loop = ctx.createLoop(ctx.signWith(ctx.identity));

  const text = await ctx.writeExport(ctx.clock.nowMs - 24 * ctx.hourMs, 'old-1');

  await Bun.write(join(ctx.spoolDir, '2026-03-01-logs.jsonl'), text.trimEnd());
  await ctx.writeExport(ctx.clock.nowMs, 'new-1');
  await loop.step();
  await loop.step();

  const stored = await ctx.readStoredIDs();

  expect(stored).toStrictEqual([
    'event:telemetry:codex.turn_cost:new-1',
    'event:telemetry:codex.turn_cost:old-1',
  ]);
});

test('it ignores a file in the spool folder that is not a spool file', async () => {
  const ctx = await setupTest();

  const loop = ctx.createLoop(ctx.signWith(ctx.identity));

  await Bun.write(join(ctx.spoolDir, '2026-03-02-metrics.jsonl'), '{"path":"/v1/logs"}\n');
  await Bun.write(join(ctx.spoolDir, 'notes.txt'), 'hello\n');

  const wait = await loop.step();

  expect({ wait, requests: ctx.requests.length }).toStrictEqual({
    wait: null,
    requests: 0,
  });
});

test('it requests /forwarded/v1/logs with an identity token that carries the claims of the design', async () => {
  const ctx = await setupTest();

  const loop = ctx.createLoop(ctx.signWith(ctx.identity));

  await ctx.writeExport(ctx.clock.nowMs, 'turn-1');
  await loop.step();

  const token = ctx.requests[0]?.token ?? '';

  const claims: unknown = JSON.parse(
    Buffer.from(token.split('.')[1] ?? '', 'base64url').toString(),
  );

  expect({ url: ctx.requests[0]?.url, claims }).toStrictEqual({
    url: 'http://ingest.test/forwarded/v1/logs',
    claims: {
      iss: 'study-pc',
      sub: '5f0c8a52-1d7e-4b3a-9c1f-2e6d7a8b9c10',
      aud: ctx.audience,
      iat: ctx.startMs / 1000 - 25,
      exp: ctx.startMs / 1000 + 30,
      jti: expect.any(String),
      imp_name: 'study-pc',
    },
  });
});

test('it holds neither the key nor a token in any log line', async () => {
  const ctx = await setupTest();
  const stranger = await ctx.createStranger();

  const loop = ctx.createLoop(ctx.signWith(stranger));

  await ctx.writeExport(ctx.clock.nowMs, 'turn-1');
  await loop.step();

  const scalars = await ctx.readKeyScalars();

  const logged = ctx.logLines.join('\n');

  expect({
    lines: ctx.logLines.length > 0,
    keys: scalars.map((scalar) => logged.includes(scalar)),
    token: ctx.requests.some((request) => logged.includes(request.token ?? 'no token')),
  }).toStrictEqual({ lines: true, keys: [false, false], token: false });
});

test('it logs one error line when it enters the stopped state, and none for a later request', async () => {
  const ctx = await setupTest();
  const stranger = await ctx.createStranger();

  const loop = ctx.createLoop(ctx.signWith(stranger));

  await ctx.writeExport(ctx.clock.nowMs, 'turn-1');
  await loop.step();
  await loop.step();

  const stopped = ctx.logLines.filter((line) => line.includes('the send loop stopped'));

  expect(stopped).toHaveLength(1);
});

test('it sleeps the retry wait between runs of a 503 and makes no request during a wait', async () => {
  const ctx = await setupTest();

  const loop = ctx.createLoop(ctx.signWith(ctx.identity));

  await ctx.writeExport(ctx.clock.nowMs, 'turn-1');

  ctx.fault.mode = 'unavailable';
  ctx.sleeper.limit = 4;

  await loop.run(ctx.stopper.signal);

  expect({ waits: ctx.waits, requests: ctx.requests.length }).toStrictEqual({
    waits: [1000, 2000, 4000, 8000],
    requests: 4,
  });
});

test('it sleeps 15 minutes after a 401, and sends one request per sleep', async () => {
  const ctx = await setupTest();
  const stranger = await ctx.createStranger();

  const loop = ctx.createLoop(ctx.signWith(stranger));

  await ctx.writeExport(ctx.clock.nowMs, 'turn-1');

  ctx.sleeper.limit = 2;

  await loop.run(ctx.stopper.signal);

  expect({ waits: ctx.waits, requests: ctx.requests.length }).toStrictEqual({
    waits: [900_000, 900_000],
    requests: 2,
  });
});

test('it wakes an idle loop when a line arrives, and sends it', async () => {
  const ctx = await setupTest();

  const loop = ctx.createLoop(ctx.signWith(ctx.identity));

  ctx.sleeper.hold = true;

  const running = loop.run(ctx.stopper.signal);

  await ctx.sleeper.entered.promise;

  await ctx.writeExport(ctx.clock.nowMs, 'turn-1');

  loop.wake();

  await ctx.requestSeen.promise;

  ctx.stopper.abort();

  await running;

  expect({ requests: ctx.requests.length, waits: ctx.waits[0] }).toStrictEqual({
    requests: 1,
    waits: 1000,
  });
});

test('it sends nothing when an older file holds a position past its end, whatever the newest file holds', async () => {
  const ctx = await setupTest();

  const loop = ctx.createLoop(ctx.signWith(ctx.identity));

  await ctx.writeExport(ctx.clock.nowMs - 24 * ctx.hourMs, 'old-1');
  await ctx.writeExport(ctx.clock.nowMs, 'new-1');

  await writePositions(ctx.spoolDir, {
    '2026-03-01-logs.jsonl': { offset: 1_000_000 },
  });

  const wait = await loop.step();

  expect({
    wait,
    requests: ctx.requests.length,
    state: loop.readState().send,
  }).toStrictEqual({
    wait: 900_000,
    requests: 0,
    state: 'stopped',
  });
});

test('it sends each request with redirect handling set to manual, so a 3xx is an answer', async () => {
  const ctx = await setupTest();

  const loop = ctx.createLoop(ctx.signWith(ctx.identity));

  await ctx.writeExport(ctx.clock.nowMs, 'turn-1');
  await loop.step();

  expect(ctx.requests.map((request) => request.redirect)).toStrictEqual(['manual']);
});

test('it waits out the bytes of the last request before it sends the next line of a backlog', async () => {
  const ctx = await setupTest();
  const first = await ctx.writeExport(ctx.clock.nowMs, 'turn-1');

  await ctx.writeExport(ctx.clock.nowMs, 'turn-2');

  // the loop sends a line's body, which is the export without the spool line's own fields
  const rate = Math.floor(first.length / 2);
  const loop = ctx.createLoop(ctx.signWith(ctx.identity), rate);
  const results = { sent: await loop.step() };

  const paced = await loop.step();

  const afterPause = { requests: ctx.requests.length };

  ctx.clock.nowMs += paced ?? 0;

  const resumed = await loop.step();

  expect({
    sent: results.sent,
    pausedWithoutRequest: afterPause.requests === 1,
    resumed,
    requests: ctx.requests.length,
  }).toStrictEqual({ sent: 0, pausedWithoutRequest: true, resumed: 0, requests: 2 });

  expect(paced).toBeGreaterThan(1000);
});

test('it never pauses for steady traffic: one small export every 10 seconds', async () => {
  const ctx = await setupTest();

  const loop = ctx.createLoop(ctx.signWith(ctx.identity), 131_072);
  const answers: (number | null)[] = [];

  for (const turn of ['turn-1', 'turn-2', 'turn-3']) {
    await ctx.writeExport(ctx.clock.nowMs, turn);

    const answer = await loop.step();

    answers.push(answer);

    ctx.clock.nowMs += 10_000;
  }

  expect({ answers, requests: ctx.requests.length }).toStrictEqual({
    answers: [0, 0, 0],
    requests: 3,
  });
});

test('it sends nothing and stops when positions.json is missing and a spool file is there', async () => {
  const ctx = await setupTest();

  const loop = ctx.createLoop(ctx.signWith(ctx.identity));

  await ctx.writeExport(ctx.clock.nowMs, 'turn-1');

  await rm(join(ctx.spoolDir, 'positions.json'));

  const wait = await loop.step();

  expect({
    wait,
    requests: ctx.requests.length,
    state: loop.readState().send,
    logged: ctx.logLines.filter((line) => line.includes('positions.json is missing')).length,
  }).toStrictEqual({ wait: 900_000, requests: 0, state: 'stopped', logged: 1 });
});

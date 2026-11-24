import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Logger } from '@pepys/kit';
import { appendFailedLine } from '../spool/append-failed-line.ts';
import { collectRetention } from '../spool/collect-retention.ts';
import { collectSpoolFileNames } from '../spool/collect-spool-file-names.ts';
import { findSpoolFileDay } from '../spool/find-spool-file-day.ts';
import { parseSpoolLine } from '../spool/parse-spool-line.ts';
import { readPositions } from '../spool/read-positions.ts';
import { readSpoolLine } from '../spool/read-spool-line.ts';
import { toUTCDay } from '../spool/to-utc-day.ts';
import type { Positions } from '../spool/types.ts';
import { writePositions } from '../spool/write-positions.ts';
import { parseAnswerReason } from './parse-answer-reason.ts';
import {
  initialRetryWaitMs,
  pickAnswerAction,
  pickNextRetryWait,
  slowRetryWaitMs,
} from './pick-answer-action.ts';
import type { AnswerAction } from './pick-answer-action.ts';
import type { SendState } from './types.ts';

interface SendLoopOptions {
  folder: string;

  // the base URL of ingest, with no trailing slash
  ingestURL: string;
  signToken: () => Promise<string>;
  post: (request: Request) => Promise<Response>;
  now: () => number;

  // Resolves after the wait, or at once when the signal aborts.
  sleep: (waitMs: number, signal: AbortSignal) => Promise<void>;
  logger: Logger;
  failedCount: number;
  requestTimeoutMs: number;
  pollMs: number;

  // The send loop starts no request until the body bytes of the last one, at this rate, have passed.
  maxBytesPerSecond: number;
}

export interface SendLoop {
  readState: () => SendState;

  // One pass: picks the line to send, sends it, and acts on the answer. It returns the wait before
  // the next pass in milliseconds, or null when no line is waiting.
  step: () => Promise<number | null>;

  // Tells an idle loop that a line arrived.
  wake: () => void;
  run: (signal: AbortSignal) => Promise<void>;
}

interface Unsent {
  name: string;
  offset: number;
  nextOffset: number;
  text: string;
}

interface FailureRecord {
  line: unknown;
  status: number | null;
  reason: string;
}

// The send loop of the forwarder: one request in flight, the newest file first.
export function createSendLoop(options: SendLoopOptions): SendLoop {
  let state: SendState = { send: 'sending', failed: options.failedCount };
  let retryWaitMs = initialRetryWaitMs;
  let serverErrors = { key: '', count: 0 };
  let paceUntilMs = 0;
  let paceMs = 0;
  let wakeIdle: (() => void) | null = null;

  const enter = (next: AnswerAction['state'], status: number | null, reason?: string): void => {
    if (next === 'sending') {
      state = { send: 'sending', failed: state.failed };

      return;
    }

    const since = state.send === next && state.since !== undefined ? state.since : toISO(options);

    if (state.send !== 'stopped' && next === 'stopped') {
      options.logger.error('the send loop stopped', { status, reason: reason ?? null });
    }

    state = { send: next, status, since, failed: state.failed };
  };

  const moveFailed = async (unsent: Unsent, failure: FailureRecord): Promise<void> => {
    await appendFailedLine(options.folder, unsent.name, {
      line: failure.line,
      failed: { at: toISO(options), status: failure.status, reason: failure.reason },
    });

    state = { ...state, failed: state.failed + 1 };

    options.logger.warn('the send loop moved a line to failed', {
      file: unsent.name,
      status: failure.status,
      reason: failure.reason,
    });
  };

  const pickWait = (action: AnswerAction): number => {
    if (action.wait === 'backoff') {
      const waitMs = retryWaitMs;

      retryWaitMs = pickNextRetryWait(retryWaitMs);

      return waitMs;
    }

    return action.wait === 'slow' ? slowRetryWaitMs : 0;
  };

  const stopWithoutAnswer = (reason: string): number => {
    if (state.send === 'stopped') {
      options.logger.error('the send loop is still stopped', { reason });
    }

    enter('stopped', null, reason);

    return slowRetryWaitMs;
  };

  const step = async (): Promise<number | null> => {
    const positions = await readPositions(options.folder);

    if (!positions.ok) {
      return stopWithoutAnswer(positions.failure);
    }

    const files = await readSpoolFiles(options.folder);
    const kept = await applyRetention(options, files, positions.value);
    const found = await readUnsent(options.folder, files, kept);

    if (found.kind === 'bad-position') {
      return stopWithoutAnswer('a position is past the end of its spool file');
    }

    if (found.kind === 'none') {
      return null;
    }

    const parsed = parseSpoolLine(found.unsent.text);

    if (parsed.kind === 'unsendable') {
      await moveFailed(found.unsent, { line: parsed.line, status: null, reason: parsed.reason });
      await movePosition(options.folder, kept, found.unsent);

      return 0;
    }

    // a wait with no request leaves the line where it is, and an idle loop never reaches this
    // a clock set back never makes the wait longer than the pause that the last request earned
    const owedMs = Math.min(paceUntilMs - options.now(), paceMs);

    if (owedMs > 0) {
      return owedMs;
    }

    const key = `${found.unsent.name}:${found.unsent.offset}`;
    const earlierErrors = serverErrors.key === key ? serverErrors.count : 0;
    const sendStartMs = options.now();

    const answer = await send(options, parsed.requestBody);

    const action = pickAnswerAction(answer.status, earlierErrors);

    serverErrors = { key, count: action.serverErrors };

    if (action.move === 'sent') {
      paceMs = Math.floor(
        (Buffer.byteLength(parsed.requestBody) * 1000) / options.maxBytesPerSecond,
      );

      paceUntilMs = sendStartMs + paceMs;
    }

    if (action.move === 'failed') {
      await moveFailed(found.unsent, {
        line: parsed.line,
        status: answer.status,
        reason: answer.reason,
      });
    }

    if (action.move !== 'stay') {
      await movePosition(options.folder, kept, found.unsent);

      retryWaitMs = initialRetryWaitMs;
    }

    enter(action.state, answer.status);

    return pickWait(action);
  };

  const waitForLine = async (signal: AbortSignal): Promise<void> => {
    const arrived = new Promise<void>((resolve) => {
      wakeIdle = resolve;
    });

    await Promise.race([arrived, options.sleep(options.pollMs, signal)]);

    wakeIdle = null;
  };

  const runStep = async (): Promise<number | null> => {
    try {
      return await step();
    } catch (error) {
      options.logger.error('the send loop failed to read or write the spool', {
        reason: error instanceof Error ? error.message : 'unknown',
      });

      return slowRetryWaitMs;
    }
  };

  return {
    readState: () => state,
    step,
    wake: () => wakeIdle?.(),
    run: async (signal) => {
      while (!signal.aborted) {
        const waitMs = await runStep();

        if (waitMs === null) {
          await waitForLine(signal);
        } else if (waitMs > 0) {
          await options.sleep(waitMs, signal);
        }
      }
    },
  };
}

function toISO(options: Pick<SendLoopOptions, 'now'>): string {
  return new Date(options.now()).toISOString();
}

interface SpoolFile {
  name: string;
  day: string;
  size: number;
}

async function readSpoolFiles(folder: string): Promise<SpoolFile[]> {
  const files: SpoolFile[] = [];
  let listing: string[] = [];

  // the receiver makes the folder with the first export
  try {
    listing = await readdir(folder);
  } catch {
    return files;
  }

  for (const name of collectSpoolFileNames(listing)) {
    const day = findSpoolFileDay(name);

    const stats = await stat(join(folder, name));

    if (day !== null) {
      files.push({ name, day, size: stats.size });
    }
  }

  return files;
}

// Marks each file of an earlier day that is sent, and deletes each file that was sent 7 days ago.
async function applyRetention(
  options: SendLoopOptions,
  files: SpoolFile[],
  positions: Positions,
): Promise<Positions> {
  const nowMs = options.now();
  const plan = collectRetention(files, positions, toUTCDay(nowMs), nowMs);

  if (plan.markSent.length === 0 && plan.remove.length === 0) {
    return positions;
  }

  const next: Positions = { ...positions };

  for (const name of plan.markSent) {
    next[name] = { offset: next[name]?.offset ?? 0, sentAt: new Date(nowMs).toISOString() };
  }

  for (const name of plan.remove) {
    await rm(join(options.folder, name), { force: true });

    delete next[name];

    files.splice(
      files.findIndex((file) => file.name === name),
      1,
    );
  }

  await writePositions(options.folder, next);

  return next;
}

type Found = { kind: 'found'; unsent: Unsent } | { kind: 'none' } | { kind: 'bad-position' };

// The first unsent line of the newest file that holds one.
async function readUnsent(
  folder: string,
  files: readonly SpoolFile[],
  positions: Positions,
): Promise<Found> {
  const newest = files[0]?.name;

  // a bad position stops the loop whichever file holds it, so the owner decides before any send
  if (files.some((file) => (positions[file.name]?.offset ?? 0) > file.size)) {
    return { kind: 'bad-position' };
  }

  for (const file of files) {
    const offset = positions[file.name]?.offset ?? 0;

    const read = await readSpoolLine(join(folder, file.name), offset, file.name !== newest);

    if (read.kind === 'past-end') {
      return { kind: 'bad-position' };
    }

    if (read.kind === 'line') {
      return {
        kind: 'found',
        unsent: { name: file.name, offset, nextOffset: read.nextOffset, text: read.text },
      };
    }
  }

  return { kind: 'none' };
}

async function movePosition(folder: string, positions: Positions, unsent: Unsent): Promise<void> {
  await writePositions(folder, {
    ...positions,
    [unsent.name]: { ...positions[unsent.name], offset: unsent.nextOffset },
  });
}

async function send(
  options: SendLoopOptions,
  requestBody: string,
): Promise<{ status: number | null; reason: string }> {
  try {
    const token = await options.signToken();

    const response = await options.post(
      new Request(`${options.ingestURL}/forwarded/v1/logs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'imp-identity': token },
        body: requestBody,
        redirect: 'manual',
        signal: AbortSignal.timeout(options.requestTimeoutMs),
      }),
    );

    const text = response.ok ? '' : await response.text();

    return { status: response.status, reason: parseAnswerReason(text) };
  } catch {
    return { status: null, reason: 'no answer from ingest' };
  }
}

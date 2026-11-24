import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { setTimeout as sleepFor } from 'node:timers/promises';
import type { Logger } from '@pepys/kit';
import { withFileLock } from '@zgeoff/std/with-file-lock';
import { createSyncedFolder } from './create-synced-folder.ts';
import { readIdentity } from './identity/read-identity.ts';
import { signIdentityToken } from './identity/sign-identity-token.ts';
import type { Identity } from './identity/types.ts';
import { createReceiver } from './receive/create-receiver.ts';
import { createSendLoop } from './send/create-send-loop.ts';
import type { SendLoop } from './send/create-send-loop.ts';
import type { SendState } from './send/types.ts';
import { readSettings } from './settings/read-settings.ts';
import type { ForwarderSettings } from './settings/read-settings.ts';
import { countFailedLines } from './spool/count-failed-lines.ts';
import { createPositionsFile } from './spool/create-positions-file.ts';
import { createSpoolAppender } from './spool/create-spool-appender.ts';

interface RunDependencies {
  environment: Readonly<Record<string, string | undefined>>;
  logger: Logger;

  // Aborts when the process is told to stop.
  signal: AbortSignal;
}

const lockFileName = 'forwarder.lock';

interface Sender {
  ingestURL: string;
  audience: string;
  maxBytesPerSecond: number;
  identity: Identity;
}

// The `run` command. It returns the exit code once the signal aborts, or at once for settings
// that cannot start the forwarder, or for a spool folder that another forwarder runs on.
export async function runForwarder(dependencies: RunDependencies): Promise<number> {
  const logger = dependencies.logger;
  const settings = readSettings(dependencies.environment);

  if (!settings.ok) {
    logger.error('the forwarder cannot start', { reason: settings.failure });

    return 1;
  }

  const listen = settings.value;
  let sender: Sender | null = null;

  if (listen.send !== null) {
    const identity = await readIdentity(listen.identityDir);

    if (!identity.ok) {
      logger.error('the forwarder cannot start', { reason: identity.failure });

      return 1;
    }

    sender = {
      ingestURL: listen.send.ingestURL,
      audience: listen.send.audience,
      maxBytesPerSecond: listen.send.maxBytesPerSecond,
      identity: { ...identity.value, issuer: listen.send.issuer },
    };
  }

  await createSyncedFolder(listen.spoolDir, 0o700);

  // Two processes on one spool folder would each move positions.json and delete sent files under
  // the other, so the lock spans the whole run. The kernel drops it when the process ends.
  const run = await withFileLock(join(listen.spoolDir, lockFileName), () =>
    runWithSpool(dependencies, listen, sender),
  );

  if (run.kind === 'busy') {
    logger.error('the forwarder cannot start', {
      reason: `another forwarder runs on the spool folder ${listen.spoolDir}`,
      pid: run.holder?.pid ?? null,
    });

    return 1;
  }

  return run.value;
}

const requestTimeoutMs = 30_000;
const pollMs = 2000;

async function runWithSpool(
  dependencies: RunDependencies,
  listen: ForwarderSettings,
  sender: Sender | null,
): Promise<number> {
  const logger = dependencies.logger;

  const failedCount = await countFailedLines(listen.spoolDir);

  await createPositionsFile(listen.spoolDir);

  const loop: SendLoop | null =
    sender === null
      ? null
      : createSendLoop({
          folder: listen.spoolDir,
          ingestURL: sender.ingestURL,
          signToken: () =>
            signIdentityToken({
              identity: sender.identity,
              audience: sender.audience,
              nowMs: Date.now(),
              jti: randomUUID(),
            }),
          post: readAnswer,
          now: () => Date.now(),
          sleep: sleepUntilAborted,
          logger,
          failedCount,
          maxBytesPerSecond: sender.maxBytesPerSecond,
          requestTimeoutMs,
          pollMs,
        });

  const readState = (): SendState => loop?.readState() ?? { send: 'off', failed: failedCount };

  const server = Bun.serve({
    hostname: listen.host,
    port: listen.port,

    // the design gives the receiver no size limit: ingest refuses an export that is too large
    maxRequestBodySize: Number.MAX_SAFE_INTEGER,
    fetch: createReceiver({
      append: createSpoolAppender({ folder: listen.spoolDir, now: () => Date.now() }),
      readState,
      now: () => Date.now(),
      logger,
      onStored: () => loop?.wake(),
    }),
  });

  const sending = loop?.run(dependencies.signal);
  const stopped = Promise.withResolvers<void>();

  dependencies.signal.addEventListener(
    'abort',
    () => {
      stopped.resolve();
    },
    { once: true },
  );

  if (dependencies.signal.aborted) {
    stopped.resolve();
  }

  await stopped.promise;

  await server.stop();

  await sending;

  return 0;
}

function readAnswer(request: Request): Promise<Response> {
  return fetch(request);
}

async function sleepUntilAborted(waitMs: number, signal: AbortSignal): Promise<void> {
  try {
    await sleepFor(waitMs, undefined, { signal });
  } catch {
    // an abort ends the wait early
  }
}

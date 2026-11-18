import { randomUUID } from 'node:crypto';
import { setTimeout as sleepFor } from 'node:timers/promises';
import type { Logger } from '@pepys/kit';
import { readIdentity } from './identity/read-identity.ts';
import { signIdentityToken } from './identity/sign-identity-token.ts';
import { createReceiver } from './receive/create-receiver.ts';
import { createSendLoop } from './send/create-send-loop.ts';
import type { SendLoop } from './send/create-send-loop.ts';
import type { SendState } from './send/types.ts';
import { readSettings } from './settings/read-settings.ts';
import { countFailedLines } from './spool/count-failed-lines.ts';
import { createSpoolAppender } from './spool/create-spool-appender.ts';

interface RunDependencies {
  environment: Readonly<Record<string, string | undefined>>;
  logger: Logger;

  // Aborts when the process is told to stop.
  signal: AbortSignal;
}

const requestTimeoutMs = 30_000;
const pollMs = 2000;

// The `run` command. It returns the exit code once the signal aborts, or at once for settings
// that cannot start the forwarder.
export async function runForwarder(dependencies: RunDependencies): Promise<number> {
  const logger = dependencies.logger;
  const settings = readSettings(dependencies.environment);

  if (!settings.ok) {
    logger.error('the forwarder cannot start', { reason: settings.failure });

    return 1;
  }

  const listen = settings.value;
  const sendSettings = listen.send;

  const failedCount = await countFailedLines(listen.spoolDir);

  let loop: SendLoop | null = null;

  if (sendSettings !== null) {
    const identity = await readIdentity(listen.identityDir);

    if (!identity.ok) {
      logger.error('the forwarder cannot start', { reason: identity.failure });

      return 1;
    }

    loop = createSendLoop({
      folder: listen.spoolDir,
      ingestURL: sendSettings.ingestURL,
      signToken: () =>
        signIdentityToken({
          identity: { ...identity.value, issuer: sendSettings.issuer },
          audience: sendSettings.audience,
          nowMs: Date.now(),
          jti: randomUUID(),
        }),
      post: readAnswer,
      now: () => Date.now(),
      sleep: sleepUntilAborted,
      logger,
      failedCount,
      requestTimeoutMs,
      pollMs,
    });
  }

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

  dependencies.signal.addEventListener('abort', () => stopped.resolve(), { once: true });

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

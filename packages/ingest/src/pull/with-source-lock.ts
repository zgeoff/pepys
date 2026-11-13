// One chain of turns per source, for the whole process: the promise that settles when every run
// that asked for the source's lock so far has ended.
export type SourceLocks = Map<string, Promise<void>>;

// Runs `work` once every earlier run of the source has ended, so the runs of one source go one
// after the other in the order they asked. Returns `stopped`, and never calls `work`, when the
// signal aborts before the turn comes.
export async function withSourceLock<Value>(
  locks: SourceLocks,
  source: string,
  signal: AbortSignal,
  work: () => Promise<Value>,
): Promise<Value | 'stopped'> {
  const previous = locks.get(source) ?? Promise.resolve();
  const done = Promise.withResolvers<void>();

  // A run that stops while it waits ends early, and the runs behind it still wait for the runs
  // ahead of it.
  const turn = waitForBoth(previous, done.promise);

  locks.set(source, turn);

  try {
    const waited = await waitForTurn(previous, signal);

    return waited === 'stopped' ? 'stopped' : await work();
  } finally {
    done.resolve();

    if (locks.get(source) === turn) {
      locks.delete(source);
    }
  }
}

async function waitForBoth(first: Promise<void>, second: Promise<void>): Promise<void> {
  await first;
  await second;
}

async function waitForTurn(
  previous: Promise<void>,
  signal: AbortSignal,
): Promise<'turn' | 'stopped'> {
  if (signal.aborted) {
    return 'stopped';
  }

  const stopped = Promise.withResolvers<void>();
  const stop = (): void => stopped.resolve();

  signal.addEventListener('abort', stop);

  try {
    await Promise.race([previous, stopped.promise]);

    return signal.aborted ? 'stopped' : 'turn';
  } finally {
    signal.removeEventListener('abort', stop);
  }
}

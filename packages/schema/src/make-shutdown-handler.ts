interface ShutdownSteps {
  stop: () => Promise<void>;
  logError: (message: string, error: unknown) => void;
  exit: (code: number) => void;
}

export function makeShutdownHandler(steps: ShutdownSteps): () => Promise<void> {
  let shutdown: Promise<void> | undefined;

  return () => {
    shutdown ??= runShutdown(steps);

    return shutdown;
  };
}

async function runShutdown(steps: ShutdownSteps): Promise<void> {
  try {
    await steps.stop();
  } catch (error: unknown) {
    steps.logError('shutdown failed', error);
    steps.exit(1);

    return;
  }

  steps.exit(0);
}

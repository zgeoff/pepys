import type { FactEnvelope } from '@pepys/schema';
import { AppendInput, AppendRecord, S2Error } from '@s2-dev/streamstore';

interface AppendTarget {
  append: (input: AppendInput) => Promise<unknown>;
}

interface FactAppenderOptions {
  stream: AppendTarget;
  maxAttempts: number;
  retryDelayMs: number;
}

// An append that fails without a definite refusal may still have been stored, so the appender
// sends it again; the fact ID makes a stored copy harmless to the consumers.
export function makeFactAppender(
  options: FactAppenderOptions,
): (fact: FactEnvelope<unknown>) => Promise<void> {
  return async (fact) => {
    const body = JSON.stringify(fact);

    for (let attempt = 1; ; attempt += 1) {
      try {
        await options.stream.append(AppendInput.create([AppendRecord.string({ body })]));

        return;
      } catch (error: unknown) {
        if (isDefiniteRefusal(error) || attempt >= options.maxAttempts) {
          throw error;
        }

        await Bun.sleep(options.retryDelayMs * attempt);
      }
    }
  };
}

// A client error from the server means the record was not stored; 408 and 429 ask for a retry.
function isDefiniteRefusal(error: unknown): boolean {
  return (
    error instanceof S2Error &&
    error.origin === 'server' &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 408 &&
    error.status !== 429
  );
}

import { formatLogLine } from './format-log-line.ts';
import type { LogDestination, Logger } from './types.ts';

export function createLogger(destination: LogDestination): Logger {
  return {
    error: (message, detail) => {
      destination.write(formatLogLine('error', message, detail));
    },
    warn: (message, detail) => {
      destination.write(formatLogLine('warn', message, detail));
    },
  };
}

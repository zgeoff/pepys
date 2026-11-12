export type LogLevel = 'error' | 'warn';

// Where a logger writes each line, such as `process.stderr`.
export interface LogDestination {
  write: (line: string) => unknown;
}

// Writes one JSON line per call: `{"level":…,"message":…,"detail":…}`, with `detail` left out when
// the call passes none.
export interface Logger {
  error: (message: string, detail?: unknown) => void;
  warn: (message: string, detail?: unknown) => void;
}

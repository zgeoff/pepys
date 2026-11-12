import { inspect } from 'node:util';
import type { LogLevel } from './types.ts';

// One JSON line, newline included, which leaves out a `detail` of undefined. A detail that JSON
// cannot hold, such as an object that refers to itself, goes in as the text `inspect` gives it, so
// a log call never throws.
export function formatLogLine(level: LogLevel, message: string, detail: unknown): string {
  try {
    return `${JSON.stringify({ level, message, detail }, toJSONValue)}\n`;
  } catch {
    return `${JSON.stringify({ level, message, detail: inspect(detail) })}\n`;
  }
}

// `JSON.stringify` writes an Error as `{}` and throws on a bigint.
function toJSONValue(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      ...(value.cause === undefined ? {} : { cause: value.cause }),
    };
  }

  return typeof value === 'bigint' ? value.toString() : value;
}

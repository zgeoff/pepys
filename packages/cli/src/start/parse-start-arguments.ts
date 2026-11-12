import { parseArgs } from 'node:util';
import type { Result } from '@pepys/kit';

export interface StartArguments {
  file: string;
}

export const startUsage = 'usage: pepys start <deployment-file>';

export function parseStartArguments(args: readonly string[]): Result<StartArguments, string> {
  const [command, ...rest] = args;

  if (command !== 'start') {
    return { ok: false, failure: startUsage };
  }

  try {
    const parsed = parseArgs({ args: rest, allowPositionals: true, options: {} });
    const [file, ...extra] = parsed.positionals;

    if (file === undefined || extra.length > 0) {
      return { ok: false, failure: startUsage };
    }

    return { ok: true, value: { file } };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    return { ok: false, failure: `${reason}\n${startUsage}` };
  }
}

import { parseArgs } from 'node:util';
import type { Result } from '@pepys/kit';

export interface BuildArguments {
  file: string;
  isCheck: boolean;
}

export const usage = 'usage: pepys build <file> [--check]';

export function parseBuildArguments(args: readonly string[]): Result<BuildArguments, string> {
  const [command, ...rest] = args;

  if (command !== 'build') {
    return { ok: false, failure: usage };
  }

  try {
    const parsed = parseArgs({
      args: rest,
      allowPositionals: true,
      options: { check: { type: 'boolean' } },
    });

    const [file, ...extra] = parsed.positionals;

    if (file === undefined || extra.length > 0) {
      return { ok: false, failure: usage };
    }

    return { ok: true, value: { file, isCheck: parsed.values.check === true } };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    return { ok: false, failure: `${reason}\n${usage}` };
  }
}

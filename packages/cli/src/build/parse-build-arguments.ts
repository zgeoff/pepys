import { parseArgs } from 'node:util';
import type { Result } from '@pepys/kit';

export interface BuildArguments {
  file: string;
  isCheck: boolean;
  out: string | undefined;
}

export const usage = 'usage: pepys build <file> [--out <directory>] [--check]';

export function parseBuildArguments(args: readonly string[]): Result<BuildArguments, string> {
  const [command, ...rest] = args;

  if (command !== 'build') {
    return { ok: false, failure: usage };
  }

  try {
    const parsed = parseArgs({
      args: rest,
      allowPositionals: true,
      options: { check: { type: 'boolean' }, out: { type: 'string' } },
    });

    const [file, ...extra] = parsed.positionals;

    if (file === undefined || extra.length > 0) {
      return { ok: false, failure: usage };
    }

    const isCheck = parsed.values.check === true;

    // --check writes nothing, so it takes no folder to write to
    if (isCheck && parsed.values.out !== undefined) {
      return { ok: false, failure: `--check takes no --out\n${usage}` };
    }

    return { ok: true, value: { file, isCheck, out: parsed.values.out } };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    return { ok: false, failure: `${reason}\n${usage}` };
  }
}

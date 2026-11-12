import type { Result } from '@pepys/kit';
import { usage as buildUsage, parseBuildArguments } from './build/parse-build-arguments.ts';
import type { BuildArguments } from './build/parse-build-arguments.ts';
import { parseStartArguments, startUsage } from './start/parse-start-arguments.ts';
import type { StartArguments } from './start/parse-start-arguments.ts';

export type CLICommand =
  | { kind: 'build'; arguments: BuildArguments }
  | { kind: 'start'; arguments: StartArguments };

export function parseCLIArguments(args: readonly string[]): Result<CLICommand, string> {
  if (args[0] === 'start') {
    const parsed = parseStartArguments(args);

    return parsed.ok ? { ok: true, value: { kind: 'start', arguments: parsed.value } } : parsed;
  }

  if (args[0] === 'build') {
    const parsed = parseBuildArguments(args);

    return parsed.ok ? { ok: true, value: { kind: 'build', arguments: parsed.value } } : parsed;
  }

  return { ok: false, failure: `${buildUsage}\n${startUsage}` };
}

import { writeStdout } from '@zgeoff/std';
import { formatBuildOutcome } from './build/format-build-outcome.ts';
import { parseBuildArguments } from './build/parse-build-arguments.ts';
import { runBuild } from './build/run-build.ts';

// Returns the exit code.
export async function runCLI(args: readonly string[]): Promise<number> {
  const parsed = parseBuildArguments(args);

  if (!parsed.ok) {
    process.stderr.write(`${parsed.failure}\n`);

    return 1;
  }

  const outcome = await runBuild(parsed.value);

  const formatted = formatBuildOutcome(outcome);

  if (formatted.exitCode === 0) {
    writeStdout(formatted.text);
  } else {
    process.stderr.write(formatted.text);
  }

  return formatted.exitCode;
}

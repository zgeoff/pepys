import { writeStdout } from '@zgeoff/std';
import { formatBuildOutcome } from './build/format-build-outcome.ts';
import { readBuildTools } from './build/read-build-tools.ts';
import { runBuild } from './build/run-build.ts';
import { parseCLIArguments } from './parse-cli-arguments.ts';
import { runStart } from './start/run-start.ts';

// Returns the exit code.
export async function runCLI(args: readonly string[]): Promise<number> {
  const parsed = parseCLIArguments(args);

  if (!parsed.ok) {
    process.stderr.write(`${parsed.failure}\n`);

    return 1;
  }

  if (parsed.value.kind === 'start') {
    return runStart({ file: parsed.value.arguments.file, environment: process.env });
  }

  const outcome = await runBuild({ ...parsed.value.arguments, tools: readBuildTools() });

  const formatted = formatBuildOutcome(outcome);

  if (formatted.exitCode === 0) {
    writeStdout(formatted.text);
  } else {
    process.stderr.write(formatted.text);
  }

  return formatted.exitCode;
}

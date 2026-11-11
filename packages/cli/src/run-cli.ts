import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeStdout } from '@zgeoff/std';
import { formatBuildOutcome } from './build/format-build-outcome.ts';
import { parseBuildArguments } from './build/parse-build-arguments.ts';
import { runBuild } from './build/run-build.ts';
import type { BuildToolPaths } from './build/run-build.ts';

// Returns the exit code.
export async function runCLI(args: readonly string[]): Promise<number> {
  const parsed = parseBuildArguments(args);

  if (!parsed.ok) {
    process.stderr.write(`${parsed.failure}\n`);

    return 1;
  }

  const outcome = await runBuild({ ...parsed.value, tools: readBuildTools() });

  const formatted = formatBuildOutcome(outcome);

  if (formatted.exitCode === 0) {
    writeStdout(formatted.text);
  } else {
    process.stderr.write(formatted.text);
  }

  return formatted.exitCode;
}

// scriptc comes with the CLI. zig and wasm-tools come from the two variables that pin a version, or
// from PATH.
function readBuildTools(): BuildToolPaths {
  const scriptcPackage = fileURLToPath(import.meta.resolve('scriptc/package.json'));

  return {
    scriptc: join(dirname(scriptcPackage), 'bin/scriptc.exe'),
    zig: process.env['PEPYS_ZIG_BIN'] ?? Bun.which('zig') ?? undefined,
    wasmTools: process.env['PEPYS_WASM_TOOLS_BIN'] ?? Bun.which('wasm-tools') ?? undefined,
  };
}

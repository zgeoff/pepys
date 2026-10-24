import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isSpikePassing } from './is-spike-passing.ts';
import { runComponentChecks } from './run-component-checks.ts';
import { runConsumerChecks } from './run-consumer-checks.ts';
import { runLibraryChecks } from './run-library-checks.ts';
import type { SpikeContext, SpikeTools } from './types.ts';

const tools = readTools();

if (tools === undefined) {
  process.stderr.write(
    'set PEPYS_WASMTIME_BIN, PEPYS_WASM_TOOLS_BIN, PEPYS_ZIG_BIN and PEPYS_WASI_ADAPTER_DIR\n',
  );

  process.exit(1);
}

const directory = mkdtempSync(join(tmpdir(), 'pepys-scriptc-wasm-'));

try {
  process.exitCode = runSpike({ tools, directory }) ? 0 : 1;
} finally {
  rmSync(directory, { recursive: true, force: true });
}

function readTools(): SpikeTools | undefined {
  const wasmtime = process.env['PEPYS_WASMTIME_BIN'];
  const wasmTools = process.env['PEPYS_WASM_TOOLS_BIN'];
  const zig = process.env['PEPYS_ZIG_BIN'];
  const adapters = process.env['PEPYS_WASI_ADAPTER_DIR'];

  if (
    wasmtime === undefined ||
    wasmTools === undefined ||
    zig === undefined ||
    adapters === undefined
  ) {
    return undefined;
  }

  return { wasmtime, wasmTools, zig, adapters };
}

function runSpike(context: SpikeContext): boolean {
  const consumer = runConsumerChecks(context);

  writeLines(consumer.lines);

  const library = runLibraryChecks(context);

  writeLines(library.lines);

  const component =
    consumer.modulePath === undefined || library.modulePath === undefined
      ? { isPassing: false, lines: ['components: skipped, a build failed'] }
      : runComponentChecks(context, consumer.modulePath, library.modulePath);

  writeLines(component.lines);

  const hasPassed = isSpikePassing({
    imports: consumer.imports,
    isEveryConstantClockOutputEqual: consumer.isEveryConstantClockOutputEqual,
    isDeterministic: library.isDeterministic,
  });

  const isVerdictSound = isVerdictSelfCheckPassing();
  const areOtherChecksPassing = consumer.isPassing && library.isPassing && component.isPassing;

  writeLines([
    `real clock, library and component checks: ${areOtherChecksPassing ? 'pass' : 'fail'}`,
    `verdict self-check on fixed evidence: ${isVerdictSound ? 'pass' : 'fail'}`,
    `passes when: ${hasPassed ? 'pass' : 'fail'}`,
  ]);

  return hasPassed && isVerdictSound && areOtherChecksPassing;
}

function isVerdictSelfCheckPassing(): boolean {
  const imports = ['wasi_snapshot_preview1.clock_time_get', 'wasi_snapshot_preview1.fd_write'];
  const passing = { imports, isEveryConstantClockOutputEqual: true, isDeterministic: true };

  return (
    isSpikePassing(passing) &&
    !isSpikePassing({ ...passing, imports: [...imports, 'wasi_snapshot_preview1.random_get'] }) &&
    !isSpikePassing({ ...passing, imports: [...imports, 'wasi_snapshot_preview1.sock_send'] }) &&
    !isSpikePassing({ ...passing, isEveryConstantClockOutputEqual: false }) &&
    !isSpikePassing({ ...passing, isDeterministic: false }) &&
    !isSpikePassing({ ...passing, isDeterministic: undefined })
  );
}

function writeLines(lines: string[]): void {
  process.stdout.write(`${lines.join('\n')}\n`);
}

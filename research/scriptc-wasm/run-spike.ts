import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  writeLines([
    `library and component checks: ${library.isPassing && component.isPassing ? 'pass' : 'fail'}`,
  ]);

  return consumer.isPassing && library.isPassing && component.isPassing;
}

function writeLines(lines: string[]): void {
  process.stdout.write(`${lines.join('\n')}\n`);
}

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BuildToolPaths } from './run-build.ts';

// scriptc and its runtime pack come with the CLI. zig and wasm-tools come from the two variables
// that pin a version, or from PATH.
export function readBuildTools(): BuildToolPaths {
  const scriptcPackage = fileURLToPath(import.meta.resolve('scriptc/package.json'));

  const runtimePackage = fileURLToPath(
    import.meta.resolve('@scriptc/runtime-wasm32-wasi/package.json'),
  );

  return {
    scriptc: join(dirname(scriptcPackage), 'bin/scriptc.exe'),
    scriptcRuntimePack: dirname(runtimePackage),
    zig: process.env['PEPYS_ZIG_BIN'] ?? Bun.which('zig') ?? undefined,
    wasmTools: process.env['PEPYS_WASM_TOOLS_BIN'] ?? Bun.which('wasm-tools') ?? undefined,
  };
}

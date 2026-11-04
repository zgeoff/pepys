// Writes PEPYS_ZIG_BIN and PEPYS_WASM_TOOLS_BIN to the file GITHUB_ENV names, from the zig and
// wasm-tools that PATH finds, so the later steps of the CI job build the consumers with them.
import { appendFile } from 'node:fs/promises';

const environmentFile = process.env['GITHUB_ENV'];
const zig = Bun.which('zig');
const wasmTools = Bun.which('wasm-tools');

if (environmentFile === undefined || zig === null || wasmTools === null) {
  console.error('needs GITHUB_ENV set, and zig and wasm-tools on PATH');
  process.exit(1);
}

await appendFile(environmentFile, `PEPYS_ZIG_BIN=${zig}\nPEPYS_WASM_TOOLS_BIN=${wasmTools}\n`);

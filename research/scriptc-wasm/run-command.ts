import { dirname } from 'node:path';
import type { SpikeTools } from './types.ts';

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  elapsedMs: number;
}

export interface CommandOptions {
  stdin?: string | Uint8Array;
  zig?: SpikeTools['zig'];
}

export function runCommand(command: string[], options: CommandOptions = {}): CommandResult {
  const startMs = performance.now();
  const path = process.env['PATH'] ?? '';

  // scriptc finds zig on PATH and cross-compiles WASI with it.
  const environment =
    options.zig === undefined
      ? process.env
      : { ...process.env, SCRIPTC_TARGET: 'wasm32-wasi', PATH: `${dirname(options.zig)}:${path}` };

  const result = Bun.spawnSync(command, {
    cwd: import.meta.dir,
    env: environment,
    stdin: options.stdin === undefined ? 'ignore' : Buffer.from(options.stdin),
  });

  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    elapsedMs: performance.now() - startMs,
  };
}

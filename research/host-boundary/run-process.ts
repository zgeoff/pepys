export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  elapsedMs: number;
}

export interface ProcessOptions {
  stdin?: string;
  environment?: Record<string, string>;
}

export function runProcess(command: string[], options: ProcessOptions = {}): ProcessResult {
  const startMs = performance.now();
  const { RUSTUP_TOOLCHAIN: _, ...inherited } = process.env;

  // A RUSTUP_TOOLCHAIN variable overrides the repo's pinned toolchain, so it never reaches cargo.
  const result = Bun.spawnSync(command, {
    cwd: import.meta.dir,
    env: { ...inherited, ...options.environment },
    stdin: options.stdin === undefined ? 'ignore' : Buffer.from(options.stdin),
  });

  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    elapsedMs: performance.now() - startMs,
  };
}

export class StackInterruptedError extends Error {
  readonly exitCode: number;

  constructor(signal: 'SIGINT' | 'SIGTERM', exitCode: number) {
    super(`stopped by ${signal}`);

    this.name = 'StackInterruptedError';
    this.exitCode = exitCode;
  }
}

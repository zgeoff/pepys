import type { CommandResult } from './run-command.ts';

export function isSameRun(expected: CommandResult, actual: CommandResult): boolean {
  return (
    expected.exitCode === actual.exitCode &&
    expected.stdout === actual.stdout &&
    expected.stderr === actual.stderr
  );
}

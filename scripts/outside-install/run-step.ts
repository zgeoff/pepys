// Runs one command of a check in `cwd`, with its output on the check's own, and throws when it
// fails.
export async function runStep(cwd: string, command: readonly string[]): Promise<void> {
  const exitCode = await Bun.spawn([...command], { cwd, stdout: 'inherit', stderr: 'inherit' })
    .exited;

  if (exitCode !== 0) {
    throw new Error(`${command.join(' ')} exited with ${exitCode}`);
  }
}

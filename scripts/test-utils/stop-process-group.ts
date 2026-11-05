// Stops a child started with `detached: true` by signalling its whole process group, so a process
// it forked stops with it, even after the child itself exited. ESRCH means the group is gone.
export async function stopProcessGroup(child: Bun.Subprocess): Promise<void> {
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch (error: unknown) {
    if (!isNoSuchProcess(error)) {
      throw error;
    }
  }

  await child.exited;
}

function isNoSuchProcess(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ESRCH';
}

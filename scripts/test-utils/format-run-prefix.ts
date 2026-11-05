// A sandbox with its own PID namespace can share the temp folder, so the prefix names the namespace
// beside the PID: the same PID there belongs to another process.
export function formatRunPrefix(pid: number, namespace: string): string {
  return `pid${pid}-ns${namespace}-`;
}

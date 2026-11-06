import { formatRunPrefix } from './format-run-prefix.ts';
import type { ReadLink } from './read-pid-namespace.ts';
import { readPIDNamespace } from './read-pid-namespace.ts';

export async function readRunPrefix(readLink: ReadLink, pid: number): Promise<string> {
  const namespace = await readPIDNamespace(readLink);

  return formatRunPrefix(pid, namespace);
}

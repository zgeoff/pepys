import type { ReadLink } from '../utils/read-pid-namespace.ts';
import { readPIDNamespace } from '../utils/read-pid-namespace.ts';
import { formatRunPrefix } from './format-run-prefix.ts';

export async function readRunPrefix(readLink: ReadLink, pid: number): Promise<string> {
  const namespace = await readPIDNamespace(readLink);

  return formatRunPrefix(pid, namespace);
}

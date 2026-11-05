import { readlink } from 'node:fs/promises';
import invariant from 'tiny-invariant';

// Linux prints the link as pid:[<namespace>].
export async function readPIDNamespace(): Promise<string> {
  const link = await readlink('/proc/self/ns/pid');

  const namespace = /^pid:\[(?<namespace>\d+)\]$/u.exec(link)?.groups?.['namespace'];

  invariant(namespace !== undefined, `unexpected PID namespace link: ${link}`);

  return namespace;
}

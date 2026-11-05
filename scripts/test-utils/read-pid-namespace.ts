import invariant from 'tiny-invariant';

export type ReadLink = (path: string) => Promise<string>;

// Linux prints the link as pid:[<namespace>].
export async function readPIDNamespace(readLink: ReadLink): Promise<string> {
  const link = await readLink('/proc/self/ns/pid');

  const namespace = /^pid:\[(?<namespace>\d+)\]$/u.exec(link)?.groups?.['namespace'];

  invariant(namespace !== undefined, `unexpected PID namespace link: ${link}`);

  return namespace;
}

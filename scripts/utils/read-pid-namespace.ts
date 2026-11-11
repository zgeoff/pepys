import invariant from 'tiny-invariant';

export type ReadLink = (path: string) => Promise<string>;

export const noPIDNamespace = 'none';

// Only Linux has /proc/self/ns/pid, and prints it as pid:[<namespace>]. On a host without it, such
// as macOS, the run has no PID namespace.
export async function readPIDNamespace(readLink: ReadLink): Promise<string> {
  const link = await readLink('/proc/self/ns/pid').catch((error: unknown) => {
    if (isMissingFileError(error)) {
      return null;
    }

    throw error;
  });

  if (link === null) {
    return noPIDNamespace;
  }

  const namespace = /^pid:\[(?<namespace>\d+)\]$/u.exec(link)?.groups?.['namespace'];

  invariant(namespace !== undefined, `unexpected PID namespace link: ${link}`);

  return namespace;
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

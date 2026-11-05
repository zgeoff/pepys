import { join } from 'node:path';
import type { ReadLink } from '../test-utils/read-pid-namespace.ts';
import { readPIDNamespace } from '../test-utils/read-pid-namespace.ts';
import { collectOwnedFolders } from './collect-owned-folders.ts';

export interface TestLeftoversDependencies {
  readonly directory: string;
  readonly readLink: ReadLink;
  readonly readDirectory: (path: string) => Promise<readonly string[]>;
  readonly removeFolder: (path: string) => Promise<void>;
  readonly signalProcess: (pid: number, signal: number) => unknown;
}

// Removes each folder in the directory that a killed test run left behind: one whose run prefix
// names this PID namespace and a process that no longer runs.
export async function removeTestLeftovers(
  dependencies: Readonly<TestLeftoversDependencies>,
): Promise<void> {
  const namespace = await readPIDNamespace(dependencies.readLink);
  const names = await dependencies.readDirectory(dependencies.directory);

  for (const folder of collectOwnedFolders(names, namespace)) {
    const isLive = probeLiveProcess(folder.pid, dependencies.signalProcess);

    if (!isLive) {
      await dependencies.removeFolder(join(dependencies.directory, folder.name));
    }
  }
}

// Signal 0 checks only that the process exists. Any error but ESRCH, such as EPERM for another
// user's process, means it still runs.
function probeLiveProcess(
  pid: number,
  signalProcess: TestLeftoversDependencies['signalProcess'],
): boolean {
  try {
    signalProcess(pid, 0);

    return true;
  } catch (error: unknown) {
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH');
  }
}

// Removes each temp folder that a killed test run left behind: a folder whose run prefix names this
// PID namespace and a process that no longer runs. The test script runs it before `bun test`.
import { readdir, readlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPIDNamespace } from '../test-utils/read-pid-namespace.ts';
import { collectOwnedFolders } from './collect-owned-folders.ts';

const directory = tmpdir();

const names = await readdir(directory);
const namespace = await readPIDNamespace(readlink);

for (const folder of collectOwnedFolders(names, namespace)) {
  if (!probeLiveProcess(folder.pid)) {
    await rm(join(directory, folder.name), { recursive: true, force: true });
  }
}

// Signal 0 checks only that the process exists. Any error but ESRCH, such as EPERM for another
// user's process, means it still runs.
function probeLiveProcess(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch (error: unknown) {
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH');
  }
}

// Removes the temp folders that a killed test run left behind. The test and related-tests scripts
// run it before rig, so the sweep runs once per run.
import { readdir, readlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { removeTestLeftovers } from './remove-test-leftovers.ts';

await removeTestLeftovers({
  directory: tmpdir(),
  readLink: readlink,
  readDirectory: readdir,
  removeFolder: (path) => rm(path, { recursive: true, force: true }),
  signalProcess: (pid, signal) => process.kill(pid, signal),
});

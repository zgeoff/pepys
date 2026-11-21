import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerTestCleanup } from '@zgeoff/testing';

interface TempDir {
  readonly path: string;
  readonly teardown: () => void;
}

export function setupTempDir(prefix: string): TempDir {
  const directory = mkdtempSync(join(tmpdir(), prefix));

  const teardown = registerTestCleanup(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  return {
    path: directory,
    teardown,
  };
}

import { noPIDNamespace } from '../test-utils/read-pid-namespace.ts';

export interface OwnedFolder {
  readonly name: string;
  readonly pid: number;
}

const runPrefixPattern = /^pid(?<pid>\d+)-ns(?<namespace>\d+)-/u;

// Without a PID namespace, a PID in a folder name may belong to a process in another sandbox, so
// a run with none owns no folder.
export function collectOwnedFolders(names: readonly string[], namespace: string): OwnedFolder[] {
  if (namespace === noPIDNamespace) {
    return [];
  }

  return names.flatMap((name) => {
    const groups = runPrefixPattern.exec(name)?.groups;

    return groups?.['namespace'] === namespace ? [{ name, pid: Number(groups['pid']) }] : [];
  });
}

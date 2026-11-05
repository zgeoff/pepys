export interface OwnedFolder {
  readonly name: string;
  readonly pid: number;
}

const runPrefixPattern = /^pid(?<pid>\d+)-ns(?<namespace>\d+)-/u;

export function collectOwnedFolders(names: readonly string[], namespace: string): OwnedFolder[] {
  return names.flatMap((name) => {
    const groups = runPrefixPattern.exec(name)?.groups;

    return groups?.['namespace'] === namespace ? [{ name, pid: Number(groups['pid']) }] : [];
  });
}

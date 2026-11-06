export interface FolderOwnerState {
  readonly name: string;
  readonly owner: 'running' | 'gone';
}

export function pickAbandonedFolders(folders: readonly FolderOwnerState[]): string[] {
  return folders.filter((folder) => folder.owner === 'gone').map((folder) => folder.name);
}

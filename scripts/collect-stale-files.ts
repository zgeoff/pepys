import type { GeneratedFile } from './build-generated-files.ts';

// The path of each generated file whose committed text differs, a missing file included.
// `committed` holds the text of each path that has a file.
export function collectStaleFiles(
  files: readonly GeneratedFile[],
  committed: ReadonlyMap<string, string>,
): string[] {
  return files.filter((file) => committed.get(file.path) !== file.content).map((file) => file.path);
}

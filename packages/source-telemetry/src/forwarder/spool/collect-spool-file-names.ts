import { findSpoolFileDay } from './find-spool-file-day.ts';

// The spool files of a folder's listing, the newest day first. Any other name is no spool file.
export function collectSpoolFileNames(names: readonly string[]): string[] {
  return names
    .filter((name) => findSpoolFileDay(name) !== null)
    .toSorted((first, second) => second.localeCompare(first));
}

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// The exports of a plug-in or deployment file, loaded the way `pepys build` and `pepys start` load it.
export function loadBuildFile(file: string): Promise<unknown> {
  return import(pathToFileURL(resolve(file)).href);
}

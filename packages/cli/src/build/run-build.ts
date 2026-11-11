import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DeploymentFailure } from '@pepys/kit';
import { isRecord, readOptionalText } from '@zgeoff/std';
import { checkBuildTarget } from './check-build-target.ts';
import { collectGlueFiles } from './collect-glue-files.ts';
import type { GlueFile } from './collect-glue-files.ts';
import { pickBuildTarget } from './pick-build-target.ts';
import type { TargetFailure } from './pick-build-target.ts';

export interface BuildOptions {
  file: string;

  // compare the glue with the files on disk and write nothing
  isCheck: boolean;
}

export type BuildOutcome =
  | { kind: 'built'; written: readonly string[]; unchanged: readonly string[] }
  | { kind: 'stale'; stale: readonly string[] }
  | { kind: 'fresh'; count: number }
  | { kind: 'no-target'; reason: TargetFailure }
  | { kind: 'invalid'; failures: readonly DeploymentFailure[] };

// Steps 1 and 2 of the build: check the target, then write the glue of each consumer.
export async function runBuild(options: BuildOptions): Promise<BuildOutcome> {
  const file = resolve(options.file);

  const loaded: unknown = await import(pathToFileURL(file).href);

  const exports = isRecord(loaded) ? loaded : {};
  const picked = pickBuildTarget(exports);

  if (!picked.ok) {
    return { kind: 'no-target', reason: picked.failure };
  }

  const checked = checkBuildTarget(picked.value);

  if (!checked.ok) {
    return { kind: 'invalid', failures: checked.failure };
  }

  const packageRoot = await readPackageRoot(dirname(file));

  const glue = collectGlueFiles({ target: checked.value, packageRoot });

  const stale = await readStalePaths(glue);

  if (options.isCheck) {
    return buildCheckOutcome(stale, glue.length);
  }

  for (const entry of glue.filter((candidate) => stale.includes(candidate.path))) {
    await mkdir(dirname(entry.path), { recursive: true });

    await Bun.write(entry.path, entry.content);
  }

  return {
    kind: 'built',
    written: stale,
    unchanged: glue.map((entry) => entry.path).filter((path) => !stale.includes(path)),
  };
}

// The nearest folder at or above the start that holds a package.json.
async function readPackageRoot(start: string): Promise<string> {
  let folder = start;

  while (!(await Bun.file(resolve(folder, 'package.json')).exists())) {
    const parent = dirname(folder);

    if (parent === folder) {
      return start;
    }

    folder = parent;
  }

  return folder;
}

async function readStalePaths(glue: readonly GlueFile[]): Promise<string[]> {
  const results = await Promise.all(
    glue.map(async (entry) => ({
      path: entry.path,
      isStale: (await readOptionalText(entry.path)) !== entry.content,
    })),
  );

  return results.filter((result) => result.isStale).map((result) => result.path);
}

function buildCheckOutcome(stale: readonly string[], count: number): BuildOutcome {
  if (stale.length > 0) {
    return { kind: 'stale', stale };
  }

  return { kind: 'fresh', count };
}

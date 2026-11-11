import { mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DeploymentFailure } from '@pepys/kit';
import { isRecord, readOptionalText } from '@zgeoff/std';
import { buildConsumerBuildManifest } from './build-consumer-build-manifest.ts';
import type { BuiltModule } from './build-consumer-build-manifest.ts';
import type { GlueFile } from './build-consumer-glue.ts';
import { checkBuildTarget } from './check-build-target.ts';
import type { CheckedTarget } from './check-build-target.ts';
import { collectGlueFiles } from './collect-glue-files.ts';
import { compileConsumer } from './compile-consumer.ts';
import type { BuildTools } from './compile-consumer.ts';
import { pickBuildTarget } from './pick-build-target.ts';
import type { TargetFailure } from './pick-build-target.ts';
import { readPackageRoot } from './read-package-root.ts';
import { writeBuildManifest } from './write-build-manifest.ts';

// scriptc comes with the CLI; a tool that the machine lacks is undefined
export interface BuildToolPaths {
  scriptc: string;
  zig: string | undefined;
  wasmTools: string | undefined;
}

export interface BuildOptions {
  file: string;

  // compare the glue with the files on disk and write nothing
  isCheck: boolean;

  // The folder for the modules and consumers.json. With none, the build stops after the glue, so a
  // plug-in author writes and tests a consumer with no zig and no wasm-tools.
  out: string | undefined;

  tools: BuildToolPaths;
}

export type BuildOutcome =
  | { kind: 'built'; written: readonly string[]; unchanged: readonly string[] }
  | {
      kind: 'compiled';
      written: readonly string[];
      unchanged: readonly string[];
      modules: readonly BuiltModule[];
      manifest: string;
    }
  | { kind: 'stale'; stale: readonly string[] }
  | { kind: 'fresh'; count: number }
  | { kind: 'no-target'; reason: TargetFailure }
  | { kind: 'invalid'; failures: readonly DeploymentFailure[] }
  | { kind: 'missing-tool'; tool: 'zig' | 'wasm-tools' }
  | { kind: 'compile-failed'; consumer: string; reason: string }
  | { kind: 'refused-manifest'; issues: readonly string[] };

// The four steps of the build: check the target, write the glue of each consumer, compile each
// entry with scriptc, and write each module and consumers.json.
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

  const foundRoot = await readPackageRoot(dirname(file));

  const glue = collectGlueFiles({
    target: checked.value,
    packageRoot: foundRoot ?? dirname(file),
  });

  const stale = await readStalePaths(glue);

  if (options.isCheck) {
    return buildCheckOutcome(stale, glue.length);
  }

  for (const entry of glue.filter((candidate) => stale.includes(candidate.path))) {
    await mkdir(dirname(entry.path), { recursive: true });

    await Bun.write(entry.path, entry.content);
  }

  const written = stale;
  const unchanged = glue.map((entry) => entry.path).filter((path) => !stale.includes(path));

  if (options.out === undefined) {
    return { kind: 'built', written, unchanged };
  }

  const zig = options.tools.zig;
  const wasmTools = options.tools.wasmTools;

  if (zig === undefined) {
    return { kind: 'missing-tool', tool: 'zig' };
  }

  if (wasmTools === undefined) {
    return { kind: 'missing-tool', tool: 'wasm-tools' };
  }

  const out = resolve(options.out);

  const compiled = await compileTarget({
    target: checked.value,
    out,
    tools: { scriptc: options.tools.scriptc, zig, wasmTools },
  });

  if (compiled.kind !== 'compiled') {
    return compiled;
  }

  const manifest = await writeBuildManifest(
    out,
    buildConsumerBuildManifest({ target: checked.value, modules: compiled.modules }),
  );

  if (!manifest.ok) {
    return { kind: 'refused-manifest', issues: manifest.failure };
  }

  return {
    kind: 'compiled',
    written,
    unchanged,
    modules: compiled.modules,
    manifest: manifest.value,
  };
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

interface CompileTargetParameters {
  target: CheckedTarget;
  out: string;
  tools: BuildTools;
}

type CompileTargetOutcome =
  | { kind: 'compiled'; modules: readonly BuiltModule[] }
  | { kind: 'compile-failed'; consumer: string; reason: string };

async function compileTarget(parameters: CompileTargetParameters): Promise<CompileTargetOutcome> {
  const families = parameters.target.checked.sources.flatMap((source) => source.families);
  const modules: BuiltModule[] = [];

  try {
    for (const plugin of parameters.target.plugins) {
      for (const consumer of plugin.consumers) {
        const built = await compileConsumer({
          consumer,
          families,
          settings: parameters.target.checked.settings[plugin.name],
          out: parameters.out,
          tools: parameters.tools,
        });

        if (!built.ok) {
          return { kind: 'compile-failed', consumer: consumer.name, reason: built.failure };
        }

        modules.push(built.value);
      }
    }
  } finally {
    await rm(join(parameters.out, '.work'), { recursive: true, force: true });
  }

  return { kind: 'compiled', modules };
}

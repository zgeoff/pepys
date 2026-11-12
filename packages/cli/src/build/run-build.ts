import { mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DeploymentFailure } from '@pepys/kit';
import { readOptionalText } from '@zgeoff/std';
import { buildConsumerBuildManifest } from './build-consumer-build-manifest.ts';
import type { BuiltModule } from './build-consumer-build-manifest.ts';
import type { GlueFile } from './build-consumer-glue.ts';
import type { CheckedTarget } from './check-build-target.ts';
import { collectGlueFiles } from './collect-glue-files.ts';
import { compileConsumer } from './compile-consumer.ts';
import type { BuildTools } from './compile-consumer.ts';
import type { TargetFailure } from './pick-build-target.ts';
import { pickCheckedTarget } from './pick-checked-target.ts';
import { pickGlueStep } from './pick-glue-step.ts';
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

  const target = pickCheckedTarget(loaded);

  if (!target.ok) {
    return target.failure;
  }

  const packageRoot = await readPackageRoot(dirname(file));

  const glue = collectGlueFiles({
    target: target.value,
    packageRoot: packageRoot ?? dirname(file),
  });

  const step = pickGlueStep({
    glue,
    committed: await readCommittedGlue(glue),
    isCheck: options.isCheck,
    out: options.out === undefined ? undefined : resolve(options.out),
    tools: options.tools,
  });

  for (const entry of step.write) {
    await mkdir(dirname(entry.path), { recursive: true });

    await Bun.write(entry.path, entry.content);
  }

  if (step.kind === 'done') {
    return step.outcome;
  }

  const compiled = await compileTarget({ target: target.value, out: step.out, tools: step.tools });

  if (compiled.kind !== 'compiled') {
    return compiled;
  }

  const manifest = await writeBuildManifest(
    step.out,
    buildConsumerBuildManifest({ target: target.value, modules: compiled.modules }),
  );

  if (!manifest.ok) {
    return { kind: 'refused-manifest', issues: manifest.failure };
  }

  return {
    kind: 'compiled',
    written: step.written,
    unchanged: step.unchanged,
    modules: compiled.modules,
    manifest: manifest.value,
  };
}

async function readCommittedGlue(glue: readonly GlueFile[]): Promise<Map<string, string>> {
  const texts = await Promise.all(
    glue.map(async (entry) => [entry.path, await readOptionalText(entry.path)] as const),
  );

  return new Map(
    texts.flatMap(([path, text]): [string, string][] => (text === undefined ? [] : [[path, text]])),
  );
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

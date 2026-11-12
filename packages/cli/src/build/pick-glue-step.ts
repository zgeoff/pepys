import type { GlueFile } from './build-consumer-glue.ts';
import type { BuildTools } from './compile-consumer.ts';
import type { BuildOutcome, BuildToolPaths } from './run-build.ts';

export interface GlueStepInput {
  glue: readonly GlueFile[];

  // the text on disk at each glue path that has a file
  committed: ReadonlyMap<string, string>;

  isCheck: boolean;

  // the absolute folder for the modules, or undefined for a build that stops after the glue
  out: string | undefined;

  tools: BuildToolPaths;
}

export type GlueStep =
  | { kind: 'done'; write: readonly GlueFile[]; outcome: BuildOutcome }
  | {
      kind: 'compile';
      write: readonly GlueFile[];
      written: readonly string[];
      unchanged: readonly string[];
      out: string;
      tools: BuildTools;
    };

// The glue files to write, and whether the build then stops or compiles. A check writes nothing.
// Every other build writes its stale glue first, even one that then stops for a missing tool.
export function pickGlueStep(input: GlueStepInput): GlueStep {
  const stale = input.glue.filter((entry) => input.committed.get(entry.path) !== entry.content);
  const written = stale.map((entry) => entry.path);

  if (input.isCheck) {
    return {
      kind: 'done',
      write: [],
      outcome:
        written.length > 0
          ? { kind: 'stale', stale: written }
          : { kind: 'fresh', count: input.glue.length },
    };
  }

  const unchanged = input.glue
    .filter((entry) => input.committed.get(entry.path) === entry.content)
    .map((entry) => entry.path);

  if (input.out === undefined) {
    return { kind: 'done', write: stale, outcome: { kind: 'built', written, unchanged } };
  }

  const zig = input.tools.zig;
  const wasmTools = input.tools.wasmTools;

  if (zig === undefined) {
    return { kind: 'done', write: stale, outcome: { kind: 'missing-tool', tool: 'zig' } };
  }

  if (wasmTools === undefined) {
    return { kind: 'done', write: stale, outcome: { kind: 'missing-tool', tool: 'wasm-tools' } };
  }

  return {
    kind: 'compile',
    write: stale,
    written,
    unchanged,
    out: input.out,
    tools: { scriptc: input.tools.scriptc, zig, wasmTools },
  };
}

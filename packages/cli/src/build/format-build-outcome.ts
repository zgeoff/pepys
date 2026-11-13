import { match } from 'ts-pattern';
import type { BuildOutcome } from './run-build.ts';

export interface FormattedOutcome {
  exitCode: 0 | 1;
  text: string;
}

const toolVariables = { zig: 'PEPYS_ZIG_BIN', 'wasm-tools': 'PEPYS_WASM_TOOLS_BIN' } as const;

export function formatBuildOutcome(outcome: BuildOutcome): FormattedOutcome {
  return match(outcome)
    .with({ kind: 'built' }, (built) => ({
      exitCode: 0 as const,
      text: [
        `wrote ${built.written.length} glue files, ${built.unchanged.length} unchanged`,
        ...built.written.map((path) => `  ${path}`),
        '',
      ].join('\n'),
    }))
    .with({ kind: 'compiled' }, (compiled) => ({
      exitCode: 0 as const,
      text: [
        `wrote ${compiled.written.length} glue files, ${compiled.unchanged.length} unchanged`,
        ...compiled.written.map((path) => `  ${path}`),
        `compiled ${compiled.modules.length} consumers`,
        ...compiled.modules.map((built) => `  ${built.name}: ${built.path}`),
        `wrote ${compiled.manifest}`,
        '',
      ].join('\n'),
    }))
    .with({ kind: 'missing-tool' }, (missing) => ({
      exitCode: 1 as const,
      text: `the glue is written; compiling needs ${missing.tool}, from ${toolVariables[missing.tool]} or PATH\n`,
    }))
    .with({ kind: 'compile-failed' }, (failed) => ({
      exitCode: 1 as const,
      text: `${failed.consumer} did not compile:\n${failed.reason}\n`,
    }))
    .with({ kind: 'refused-manifest' }, (refused) => ({
      exitCode: 1 as const,
      text: [
        'the host would refuse this consumers.json, so the build wrote none:',
        ...refused.issues.map((issue) => `  ${issue}`),
        '',
      ].join('\n'),
    }))
    .with({ kind: 'fresh' }, (fresh) => ({
      exitCode: 0 as const,
      text: `${fresh.count} glue files are up to date\n`,
    }))
    .with({ kind: 'stale' }, (stale) => ({
      exitCode: 1 as const,
      text: [
        'glue files differ from the declarations; run `pepys build`:',
        ...stale.stale.map((path) => `  ${path}`),
        '',
      ].join('\n'),
    }))
    .with({ kind: 'no-target' }, (missing) => ({
      exitCode: 1 as const,
      text:
        missing.reason === 'no-target'
          ? 'the file exports no Deployment and no Plugin\n'
          : 'the file exports more than one Deployment or Plugin\n',
    }))
    .with({ kind: 'invalid' }, (invalid) => ({
      exitCode: 1 as const,
      text: [
        'the declarations are invalid:',
        ...invalid.failures.map((failure) => `  ${JSON.stringify(failure)}`),
        '',
      ].join('\n'),
    }))
    .exhaustive();
}

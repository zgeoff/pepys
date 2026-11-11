import type { DeploymentFailure } from '@pepys/kit';
import { match } from 'ts-pattern';
import type { BuildOutcome } from './run-build.ts';

export interface FormattedOutcome {
  exitCode: 0 | 1;
  text: string;
}

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
        ...invalid.failures.map((failure) => `  ${formatFailure(failure)}`),
        '',
      ].join('\n'),
    }))
    .exhaustive();
}

function formatFailure(failure: DeploymentFailure): string {
  return JSON.stringify(failure);
}

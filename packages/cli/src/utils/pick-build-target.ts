import type { Deployment, Plugin, Result } from '@pepys/kit';
import { isRecord } from '@zgeoff/std';

export type BuildTarget =
  | { kind: 'deployment'; deployment: Deployment }
  | { kind: 'plugin'; plugin: Plugin };

export type TargetFailure = 'no-target' | 'several-targets';

// The file exports one Deployment or Plugin, under any name or as the default export. A value
// exported twice counts once.
export function pickBuildTarget(
  exports: Readonly<Record<string, unknown>>,
): Result<BuildTarget, TargetFailure> {
  const targets = [...new Set(Object.values(exports))]
    .map((value) => toBuildTarget(value))
    .filter((target) => target !== undefined);

  const [first, ...others] = targets;

  if (first === undefined) {
    return { ok: false, failure: 'no-target' };
  }

  if (others.length > 0) {
    return { ok: false, failure: 'several-targets' };
  }

  return { ok: true, value: first };
}

function toBuildTarget(value: unknown): BuildTarget | undefined {
  if (isDeployment(value)) {
    return { kind: 'deployment', deployment: value };
  }

  if (isPlugin(value)) {
    return { kind: 'plugin', plugin: value };
  }

  return undefined;
}

function isDeployment(value: unknown): value is Deployment {
  return isRecord(value) && typeof value['name'] === 'string' && Array.isArray(value['plugins']);
}

function isPlugin(value: unknown): value is Plugin {
  return (
    isRecord(value) &&
    typeof value['name'] === 'string' &&
    typeof value['kit'] === 'number' &&
    Array.isArray(value['consumers'])
  );
}

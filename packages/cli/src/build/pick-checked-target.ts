import type { Result } from '@pepys/kit';
import { isRecord } from '@zgeoff/std';
import { checkBuildTarget } from './check-build-target.ts';
import type { CheckedTarget } from './check-build-target.ts';
import { pickBuildTarget } from './pick-build-target.ts';
import type { BuildOutcome } from './run-build.ts';

type TargetRefusal = Extract<BuildOutcome, { kind: 'no-target' } | { kind: 'invalid' }>;

// The checked target of a loaded plug-in or deployment file, or the outcome that refuses it.
export function pickCheckedTarget(loaded: unknown): Result<CheckedTarget, TargetRefusal> {
  const exports = isRecord(loaded) ? loaded : {};
  const picked = pickBuildTarget(exports);

  if (!picked.ok) {
    return { ok: false, failure: { kind: 'no-target', reason: picked.failure } };
  }

  const checked = checkBuildTarget(picked.value);

  if (!checked.ok) {
    return { ok: false, failure: { kind: 'invalid', failures: checked.failure } };
  }

  return checked;
}

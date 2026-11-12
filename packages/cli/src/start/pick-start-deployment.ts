import type { Deployment, Result } from '@pepys/kit';
import { isRecord } from '@zgeoff/std';
import { pickBuildTarget } from '../build/pick-build-target.ts';

// The deployment that a loaded file exports, or the line that says why `pepys start` refuses it.
export function pickStartDeployment(loaded: unknown): Result<Deployment, string> {
  const exports = isRecord(loaded) ? loaded : {};
  const picked = pickBuildTarget(exports);

  if (!picked.ok) {
    const failure =
      picked.failure === 'no-target'
        ? 'the file exports no Deployment and no Plugin'
        : 'the file exports more than one Deployment or Plugin';

    return { ok: false, failure };
  }

  if (picked.value.kind === 'plugin') {
    return { ok: false, failure: 'the file exports a Plugin, and pepys start runs a Deployment' };
  }

  return { ok: true, value: picked.value.deployment };
}

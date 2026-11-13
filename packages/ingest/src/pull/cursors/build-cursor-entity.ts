import type { EntityID } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import type { PullPathName } from '../make-pull-runner.ts';

// The entity of a pull path's cursor records, such as `github:pull_path:recovery`.
export function buildCursorEntity(source: string, path: PullPathName): EntityID {
  return toTagged<EntityID>(`${source}:pull_path:${path}`);
}

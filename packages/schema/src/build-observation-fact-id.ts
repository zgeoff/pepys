import { toTagged } from '@zgeoff/std';
import { buildFactHash } from './build-fact-hash.ts';
import type { EntityID, FactID } from './types.ts';

interface ObservationFactIDParts {
  source: string;
  entity: EntityID;
  sourceUpdateTime: string;
}

export function buildObservationFactID(parts: ObservationFactIDParts): FactID {
  const hash = buildFactHash([parts.source, parts.entity, parts.sourceUpdateTime]);

  return toTagged<FactID>(`observation:${hash}`);
}

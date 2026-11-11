import { toTagged } from '@zgeoff/std';
import type { FactID } from '../ids/types.ts';

interface EventFactIDParts {
  source: string;
  event: string;
}

export function buildEventFactID(parts: EventFactIDParts): FactID {
  return toTagged<FactID>(`event:${parts.source}:${parts.event}`);
}

import { toTagged } from '@zgeoff/std';
import type { FactID } from './types.ts';

export function buildManualFactID(): FactID {
  return toTagged<FactID>(`manual:${Bun.randomUUIDv7()}`);
}

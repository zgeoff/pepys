import { toTagged } from '@zgeoff/std';
import type { StreamOffset } from './types.ts';

export function toStreamOffset(offset: number): StreamOffset {
  return toTagged<StreamOffset>(offset);
}

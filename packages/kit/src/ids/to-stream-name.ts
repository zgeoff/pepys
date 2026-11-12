import { toTagged } from '@zgeoff/std';
import type { DeclaredStreamName } from '../types.ts';
import type { StreamName } from './types.ts';

export function toStreamName(stream: DeclaredStreamName): StreamName {
  return toTagged<StreamName>(stream);
}

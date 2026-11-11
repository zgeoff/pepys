import { toTagged } from '@zgeoff/std';
import type { ClientID, FactID, RequestID } from '../ids/types.ts';
import { buildFactHash } from './build-fact-hash.ts';

export function buildManualFactID(client: ClientID, request: RequestID): FactID {
  return toTagged<FactID>(`manual:${buildFactHash([client, request])}`);
}

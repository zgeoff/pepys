import { toTagged } from '@zgeoff/std';
import { buildFactHash } from './build-fact-hash.ts';
import type { ClientID, FactID, RequestID } from './ids/ids.ts';

export function buildManualFactID(client: ClientID, request: RequestID): FactID {
  return toTagged<FactID>(`manual:${buildFactHash([client, request])}`);
}

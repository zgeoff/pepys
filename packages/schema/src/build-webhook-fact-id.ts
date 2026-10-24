import { toTagged } from '@zgeoff/std';
import type { FactID } from './types.ts';

interface WebhookFactIDParts {
  source: string;
  deliveryID: string;
}

export function buildWebhookFactID(parts: WebhookFactIDParts): FactID {
  return toTagged<FactID>(`webhook:${parts.source}:${parts.deliveryID}`);
}

import type { LogRecord } from '../otlp/types.ts';

// An event that `read` turns into a fact: the product, the short event name, and for an event that
// one attribute splits into kinds, that attribute's `kind`.
export interface KeptEvent {
  readonly product: string;
  readonly event: string;
  readonly kind?: string;
}

// The only events `read` keeps: those that feed a table or a planned reader. An event that no entry
// names makes no fact, so a new event type is dropped until someone lists it here.
export const keptEvents: readonly KeptEvent[] = [
  { product: 'claude_code', event: 'api_request' },
  { product: 'claude_code', event: 'tool_decision' },
  { product: 'codex', event: 'tool_decision' },
  { product: 'codex', event: 'sse_event', kind: 'response.completed' },
  { product: 'codex', event: 'turn_cost' },
];

export function isKeptEvent(
  list: readonly KeptEvent[],
  product: string,
  event: string,
  record: LogRecord,
): boolean {
  return list.some(
    (kept) =>
      kept.product === product &&
      kept.event === event &&
      (kept.kind === undefined ||
        (record.attributes['event.kind'] ?? record.resource['event.kind']) === kept.kind),
  );
}

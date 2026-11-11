import type { LogRecord } from '../../otlp/types.ts';
import { defineTelemetryProduct } from '../define-telemetry-product.ts';
import { findAttributeText } from '../find-attribute-text.ts';

const eventPrefix = 'codex.';

export const codexProduct = defineTelemetryProduct({
  name: 'codex',
  readEvent: findCodexEvent,
  agentSessionAttribute: 'conversation.id',
  timeAttribute: 'event.timestamp',

  // Any other `codex.*` event is stored as `telemetry.codex.unlisted`. With no `key`, the fact ID
  // holds a hash of what Codex wrote.
  events: {
    sse_event: {},
    api_request: {},
    turn_cost: { key: (record) => findAttributeText(record, 'turn.id') },
    conversation_starts: {},
    user_prompt: {},
    tool_decision: {},
    tool_result: {},
  },
});

// Codex puts the full name in `event.name`, such as `codex.sse_event`.
function findCodexEvent(record: LogRecord): string | undefined {
  const name = findAttributeText(record, 'event.name');

  if (name === undefined || !name.startsWith(eventPrefix)) {
    return undefined;
  }

  const event = name.slice(eventPrefix.length);

  return event === '' ? undefined : event;
}

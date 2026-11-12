import type { LogRecord } from '../../otlp/types.ts';
import { defineTelemetryProduct } from '../define-telemetry-product.ts';
import { findAttributeText } from '../find-attribute-text.ts';

const scopePrefix = 'com.anthropic.claude_code';
const eventPrefix = 'claude_code.';

export const claudeCodeProduct = defineTelemetryProduct({
  name: 'claude_code',
  readEvent: findClaudeCodeEvent,
  agentSessionAttribute: 'session.id',
  timeAttribute: 'event.timestamp',
  sequenceAttribute: 'event.sequence',

  // An event with no key of its own is keyed by its session and sequence. `api_request` and
  // `api_error` can share a request ID; the event name in the fact ID keeps the two apart.
  events: {
    api_request: { key: findRequestKey },
    api_error: { key: findRequestKey },
    api_refusal: { key: (record) => findAttributeText(record, 'request_id') },
    user_prompt: {},
    assistant_response: {},
    tool_result: { key: (record) => findAttributeText(record, 'tool_use_id') },
    tool_decision: {},
  },
});

// Neither the scope name nor the event name's prefix on the wire is checked against a capture, so
// either one marks a record as Claude Code's, and the event is the name without the prefix.
function findClaudeCodeEvent(record: LogRecord): string | undefined {
  const name = findAttributeText(record, 'event.name');

  if (name === undefined) {
    return undefined;
  }

  if (name.startsWith(eventPrefix)) {
    const event = name.slice(eventPrefix.length);

    return event === '' ? undefined : event;
  }

  return record.scope.name.startsWith(scopePrefix) ? name : undefined;
}

function findRequestKey(record: LogRecord): string | undefined {
  return findAttributeText(record, 'request_id') ?? findAttributeText(record, 'client_request_id');
}

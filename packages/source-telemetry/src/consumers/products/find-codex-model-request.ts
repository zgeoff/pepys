import { findRecordInteger, findRecordText } from './find-record-number.ts';
import type { ModelRequestFields, StoredRecord } from './types.ts';

// One `sse_event` record of the kind `response.completed` is one model request. Codex reports no
// cost for one request, and counts the cached and cache-write tokens inside its input count.
export function findCodexModelRequest(
  event: string,
  record: StoredRecord,
): ModelRequestFields | undefined {
  if (event !== 'sse_event' || findRecordText(record, 'event.kind') !== 'response.completed') {
    return undefined;
  }

  const model = findRecordText(record, 'model');
  const inputTokens = findRecordInteger(record, 'input_token_count');
  const outputTokens = findRecordInteger(record, 'output_token_count');
  const cachedTokens = findRecordInteger(record, 'cached_token_count') ?? 0;
  const cacheWriteTokens = findRecordInteger(record, 'cache_write_token_count') ?? 0;

  if (model === undefined || inputTokens === undefined || outputTokens === undefined) {
    return undefined;
  }

  return {
    agent_session: findRecordText(record, 'conversation.id') ?? null,
    model,
    input_tokens: Math.max(inputTokens - cachedTokens - cacheWriteTokens, 0),
    cache_read_tokens: cachedTokens,
    cache_creation_tokens: cacheWriteTokens,
    output_tokens: outputTokens,
    reported_cost_usd: null,
    duration_ms: findRecordInteger(record, 'duration_ms') ?? null,
    agent: null,
  };
}

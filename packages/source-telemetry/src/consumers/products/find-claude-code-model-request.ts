import { findRecordInteger, findRecordNumber, findRecordText } from './find-record-number.ts';
import type { ModelRequestFields, StoredRecord } from './types.ts';

// One `api_request` record is one model request, with the cost Claude Code reports for it. A record
// with no model or no token count makes no row: no figure is invented.
export function findClaudeCodeModelRequest(
  event: string,
  record: StoredRecord,
): ModelRequestFields | undefined {
  if (event !== 'api_request') {
    return undefined;
  }

  const model = findRecordText(record, 'model');
  const inputTokens = findRecordInteger(record, 'input_tokens');
  const cacheReadTokens = findRecordInteger(record, 'cache_read_tokens');
  const cacheCreationTokens = findRecordInteger(record, 'cache_creation_tokens');
  const outputTokens = findRecordInteger(record, 'output_tokens');

  if (
    model === undefined ||
    inputTokens === undefined ||
    cacheReadTokens === undefined ||
    cacheCreationTokens === undefined ||
    outputTokens === undefined
  ) {
    return undefined;
  }

  return {
    agent_session: findRecordText(record, 'session.id') ?? null,
    model,
    input_tokens: inputTokens,
    cache_read_tokens: cacheReadTokens,
    cache_creation_tokens: cacheCreationTokens,
    output_tokens: outputTokens,
    reported_cost_usd: findRecordNumber(record, 'cost_usd') ?? null,
    duration_ms: findRecordInteger(record, 'duration_ms') ?? null,
    agent: null,
  };
}

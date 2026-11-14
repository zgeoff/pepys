export interface ModelRequest {
  id: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd?: number | undefined;
  at: string;
}

// One OTLP JSON logs export, as Claude Code's exporter writes it: an integer as a JSON number, and
// the full event name in each record's body.
export function buildTelemetryExport(session: string, requests: readonly ModelRequest[]) {
  return {
    resourceLogs: [
      {
        resource: { attributes: [buildAttribute('atc.session.id', session)] },
        scopeLogs: [
          {
            scope: { name: 'com.anthropic.claude_code.events' },
            logRecords: requests.map((request) => buildRecord(session, request)),
          },
        ],
      },
    ],
  };
}

type AttributeValue = { stringValue: string } | { intValue: number } | { doubleValue: number };

function buildAttribute(
  key: string,
  value: string | number,
): { key: string; value: AttributeValue } {
  if (typeof value === 'string') {
    return { key, value: { stringValue: value } };
  }

  return { key, value: Number.isInteger(value) ? { intValue: value } : { doubleValue: value } };
}

function buildRecord(session: string, request: ModelRequest) {
  const cost = request.costUsd === undefined ? [] : [buildAttribute('cost_usd', request.costUsd)];

  return {
    timeUnixNano: String(Date.parse(request.at) * 1_000_000),
    observedTimeUnixNano: String(Date.parse(request.at) * 1_000_000),
    body: { stringValue: 'claude_code.api_request' },
    attributes: [
      buildAttribute('event.name', 'api_request'),
      buildAttribute('session.id', session),
      buildAttribute('event.timestamp', request.at),
      buildAttribute('request_id', request.id),
      buildAttribute('model', request.model),
      buildAttribute('input_tokens', request.inputTokens),
      buildAttribute('output_tokens', request.outputTokens),
      buildAttribute('cache_read_tokens', request.cacheReadTokens),
      buildAttribute('cache_creation_tokens', request.cacheCreationTokens),
      ...cost,
    ],
  };
}

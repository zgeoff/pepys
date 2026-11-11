import type { LogsExport, OtlpKeyValue } from '../otlp/types.ts';

type Attributes = Readonly<Record<string, string | number | boolean>>;

const scopeNames = {
  claude_code: 'com.anthropic.claude_code.events',
  codex: 'codex_otel',
} as const;

// An OTLP JSON logs export with one resource and one scope, as the product's exporter writes it: an
// integer is decimal text in `intValue`, as OTLP JSON writes a 64-bit integer.
export function buildLogsExport(
  product: keyof typeof scopeNames,
  resource: Attributes,
  records: readonly Attributes[],
): LogsExport {
  return {
    resourceLogs: [
      {
        resource: { attributes: buildKeyValues(resource) },
        scopeLogs: [
          {
            scope: { name: scopeNames[product] },
            logRecords: records.map((record) => ({
              timeUnixNano: '1794370800000000000',
              observedTimeUnixNano: '1794370800500000000',
              body: { stringValue: 'event' },
              attributes: buildKeyValues(record),
            })),
          },
        ],
      },
    ],
  };
}

function buildKeyValues(attributes: Attributes): OtlpKeyValue[] {
  return Object.entries(attributes).map(([key, value]) => ({ key, value: buildValue(value) }));
}

function buildValue(value: string | number | boolean): unknown {
  if (typeof value === 'string') {
    return { stringValue: value };
  }

  if (typeof value === 'boolean') {
    return { boolValue: value };
  }

  return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
}

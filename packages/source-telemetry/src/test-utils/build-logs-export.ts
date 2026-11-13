import type { LogsExport, OtlpKeyValue } from '../otlp/types.ts';

type Attributes = Readonly<Record<string, string | number | boolean>>;

type Product = 'claude_code' | 'codex';

const scopeNames = {
  claude_code: 'com.anthropic.claude_code.events',
  codex: 'codex_otel.log_only',
} as const;

// An OTLP JSON logs export with one resource and one scope, as the product's exporter writes it.
// Claude Code writes an integer as a JSON number and the full event name in the body. Codex writes
// an integer as decimal text and an empty body.
export function buildLogsExport(
  product: Product,
  resource: Attributes,
  records: readonly Attributes[],
): LogsExport {
  return {
    resourceLogs: [
      {
        resource: { attributes: buildKeyValues(product, resource) },
        scopeLogs: [
          {
            scope: { name: scopeNames[product] },
            logRecords: records.map((record) => ({
              timeUnixNano: '1794370800000000000',
              observedTimeUnixNano: '1794370800500000000',
              body: buildBody(product, record),
              attributes: buildKeyValues(product, record),
            })),
          },
        ],
      },
    ],
  };
}

function buildKeyValues(product: Product, attributes: Attributes): OtlpKeyValue[] {
  return Object.entries(attributes).map(([key, value]) => ({
    key,
    value: buildValue(product, value),
  }));
}

function buildValue(product: Product, value: string | number | boolean): unknown {
  if (typeof value === 'string') {
    return { stringValue: value };
  }

  if (typeof value === 'boolean') {
    return { boolValue: value };
  }

  if (!Number.isInteger(value)) {
    return { doubleValue: value };
  }

  return { intValue: product === 'codex' ? String(value) : value };
}

const claudeCodePrefix = 'claude_code.';

function buildBody(product: Product, record: Attributes): unknown {
  if (product === 'codex') {
    return {};
  }

  const name = record['event.name'];

  if (typeof name !== 'string') {
    return { stringValue: '' };
  }

  return { stringValue: name.startsWith(claudeCodePrefix) ? name : `${claudeCodePrefix}${name}` };
}

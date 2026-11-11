// The body of an OTLP/HTTP logs export in its JSON form. Only the fields ingest reads are typed.
export interface LogsExport {
  resourceLogs: readonly ResourceLogs[];
}

export interface ResourceLogs {
  resource: { attributes: readonly OtlpKeyValue[] };
  scopeLogs: readonly ScopeLogs[];
}

export interface ScopeLogs {
  scope: { name: string; version?: string | undefined };
  logRecords: readonly OtlpLogRecord[];
}

export interface OtlpKeyValue {
  key: string;
  value: unknown;
}

// A record as the exporter wrote it. OTLP JSON writes a 64-bit integer as text, and an exporter
// may write it as a number, so each field the exporter owns stays as it came.
export interface OtlpLogRecord {
  readonly [field: string]: unknown;
  attributes?: OtlpKeyValue[] | undefined;
}

export type AttributeValue = string | number | boolean;

// What a product's functions get: one record with its attributes as plain maps. Never stored.
export interface LogRecord {
  scope: { name: string };
  resource: Readonly<Record<string, AttributeValue>>;
  attributes: Readonly<Record<string, AttributeValue>>;
  raw: OtlpLogRecord;
}

import type { LogRecord } from '../otlp/types.ts';

// The record's attribute as text: a number counts, since an exporter may write an ID either way.
export function findAttributeText(record: LogRecord, name: string): string | undefined {
  const value = record.attributes[name];

  if (typeof value === 'string') {
    return value === '' ? undefined : value;
  }

  return typeof value === 'number' ? String(value) : undefined;
}

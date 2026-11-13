import type { KeyValue, StoredRecord } from './types.ts';

// Claude Code writes a count as a JSON number, and Codex writes it as decimal text, so both count.
export function findRecordNumber(record: StoredRecord, name: string): number | undefined {
  const value = findRecordAttribute(record, name);

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value !== 'string' || !isDecimalText(value)) {
    return undefined;
  }

  const number = Number(value);

  return Number.isFinite(number) ? number : undefined;
}

export function findRecordInteger(record: StoredRecord, name: string): number | undefined {
  const number = findRecordNumber(record, name);

  return number !== undefined && Number.isSafeInteger(number) ? number : undefined;
}

// non-empty text; a number becomes its decimal text
export function findRecordText(record: StoredRecord, name: string): string | undefined {
  const value = findRecordAttribute(record, name);

  if (typeof value === 'number') {
    return String(value);
  }

  return typeof value === 'string' && value !== '' ? value : undefined;
}

type Scalar = string | number | boolean;

// The record's own attribute first, then the resource's. An OTLP value is a one-key object, such as
// `{ "intValue": "12" }`, and a list or a map value counts as absent.
function findRecordAttribute(record: StoredRecord, name: string): Scalar | undefined {
  const own = findValue(record.logRecord.attributes ?? [], name);

  return own ?? findValue(record.resource.attributes, name);
}

function findValue(attributes: readonly KeyValue[], name: string): Scalar | undefined {
  for (const attribute of attributes) {
    if (attribute.key === name) {
      return toScalar(attribute.value);
    }
  }

  return undefined;
}

function toScalar(value: unknown): Scalar | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }

  const text = 'stringValue' in value ? value.stringValue : undefined;
  const integer = 'intValue' in value ? value.intValue : undefined;
  const double = 'doubleValue' in value ? value.doubleValue : undefined;
  const flag = 'boolValue' in value ? value.boolValue : undefined;

  if (typeof text === 'string') {
    return text;
  }

  if (typeof integer === 'number' || typeof integer === 'string') {
    return integer;
  }

  if (typeof double === 'number' || typeof double === 'string') {
    return double;
  }

  return typeof flag === 'boolean' ? flag : undefined;
}

// Digits with one optional leading minus and one optional point, such as `-12` or `0.4`. `Number`
// alone would also take an empty text, hex and `Infinity`.
function isDecimalText(text: string): boolean {
  let digits = 0;
  let points = 0;

  for (let index = 0; index < text.length; index += 1) {
    const character = text.charAt(index);

    if (character >= '0' && character <= '9') {
      digits += 1;
    } else if (character === '.') {
      points += 1;
    } else if (character !== '-' || index !== 0) {
      return false;
    }
  }

  return digits > 0 && points <= 1;
}

import { isRecord } from '@zgeoff/std';
import type { AttributeValue, OtlpKeyValue } from './types.ts';

// The scalar attributes as a plain map. OTLP JSON writes a 64-bit integer as text, and an exporter
// may write any number as text, so an `intValue` that is a safe integer becomes a number. A list or
// a map value has no entry.
export function toAttributeMap(
  attributes: readonly OtlpKeyValue[],
): Readonly<Record<string, AttributeValue>> {
  return Object.fromEntries(
    attributes.flatMap((attribute) => {
      const value = toAttributeValue(attribute.value);

      return value === undefined ? [] : [[attribute.key, value] as const];
    }),
  );
}

function toAttributeValue(value: unknown): AttributeValue | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const text = value['stringValue'];
  const integer = value['intValue'];
  const double = value['doubleValue'];
  const flag = value['boolValue'];

  if (typeof text === 'string') {
    return text;
  }

  if (typeof integer === 'number' || typeof integer === 'string') {
    return toInteger(integer);
  }

  if (typeof double === 'number' || typeof double === 'string') {
    return toDouble(double);
  }

  return typeof flag === 'boolean' ? flag : undefined;
}

function toInteger(value: number | string): AttributeValue {
  if (typeof value === 'string' && !/^-?\d+$/u.test(value)) {
    return value;
  }

  const number = Number(value);

  return Number.isSafeInteger(number) ? number : String(value);
}

// OTLP JSON writes NaN and the infinities as text.
function toDouble(value: number | string): AttributeValue | undefined {
  if (typeof value === 'string' && value.trim() === '') {
    return undefined;
  }

  const number = Number(value);

  return Number.isFinite(number) ? number : undefined;
}

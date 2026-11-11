import { isRecord } from '@zgeoff/std';

// JSON with the keys of every object sorted and no white space, so one value has one text whatever
// the key order the exporter wrote.
export function formatCanonicalJSON(value: unknown): string {
  return JSON.stringify(toSortedValue(value));
}

function toSortedValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item: unknown) => toSortedValue(item));
  }

  if (!isRecord(value)) {
    return value;
  }

  // `fromEntries` defines each key as an own property, so a `__proto__` key stays a key
  return Object.fromEntries(
    Object.keys(value)
      .toSorted()
      .map((key) => [key, toSortedValue(value[key])]),
  );
}

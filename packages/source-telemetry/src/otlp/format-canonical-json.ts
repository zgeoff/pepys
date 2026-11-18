import { isRecord } from '@zgeoff/std';

// JSON with the keys of every object sorted and no white space, so one value has one text whatever
// the key order the exporter wrote. It throws `NestedTooDeepError` for a value nested more than 64
// levels deep.
export function formatCanonicalJSON(value: unknown): string {
  return JSON.stringify(toSortedValue(value, 0));
}

const maxDepth = 64;

function toSortedValue(value: unknown, depth: number): unknown {
  if (!Array.isArray(value) && !isRecord(value)) {
    return value;
  }

  if (depth >= maxDepth) {
    throw new NestedTooDeepError();
  }

  if (Array.isArray(value)) {
    return value.map((item: unknown) => toSortedValue(item, depth + 1));
  }

  // `fromEntries` defines each key as an own property, so a `__proto__` key stays a key
  return Object.fromEntries(
    Object.keys(value)
      .toSorted()
      .map((key) => [key, toSortedValue(value[key], depth + 1)] as const),
  );
}

// The walk is recursive, and a body of tens of thousands of nested arrays would exhaust the stack.
export class NestedTooDeepError extends Error {
  constructor() {
    super(`the value nests more than ${maxDepth} levels deep`);

    this.name = 'NestedTooDeepError';
  }
}

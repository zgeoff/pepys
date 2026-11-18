import { isRecord } from '@zgeoff/std';
import invariant from 'tiny-invariant';
import { maxNestingDepth } from './is-nested-too-deep.ts';

// JSON with the keys of every object sorted and no white space, so one value has one text whatever
// the key order the exporter wrote.
export function formatCanonicalJSON(value: unknown): string {
  return JSON.stringify(toSortedValue(value, 0));
}

function toSortedValue(value: unknown, depth: number): unknown {
  if (!Array.isArray(value) && !isRecord(value)) {
    return value;
  }

  // the walk is recursive, and the stack holds it only for a value the route has checked
  invariant(depth < maxNestingDepth, 'the caller checks the nesting depth of the value first');

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

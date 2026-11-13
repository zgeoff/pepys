import { createHash } from 'node:crypto';

// The SHA-256 of the canonical JSON of a value: keys sorted at every depth, no white space. Two
// bodies that parse to one JSON value give one hash, however each was spaced or ordered.
export function buildBodyHash(value: unknown): string {
  return createHash('sha256').update(formatCanonicalJSON(value)).digest('hex');
}

function formatCanonicalJSON(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item: unknown) => formatCanonicalJSON(item)).join(',')}]`;
  }

  if (typeof value === 'object' && value !== null) {
    // code-unit order, as JSON canonical forms sort keys, and never the locale's order
    const entries = Object.entries(value)
      .toSorted(([left], [right]) => compareCodeUnits(left, right))
      .map(
        ([key, item]: [string, unknown]) => `${JSON.stringify(key)}:${formatCanonicalJSON(item)}`,
      );

    return `{${entries.join(',')}}`;
  }

  return JSON.stringify(value);
}

function compareCodeUnits(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

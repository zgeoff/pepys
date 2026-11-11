// The value at a path of keys inside a parsed JSON value, or undefined when a step is no object or
// has no such key. A consumer reads a delivery body with it and no schema library.
export function findField(value: unknown, ...path: readonly string[]): unknown {
  let current = value;

  for (const key of path) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) {
      return undefined;
    }

    if (!Object.hasOwn(current, key)) {
      return undefined;
    }

    current = Reflect.get(current, key);
  }

  return current;
}

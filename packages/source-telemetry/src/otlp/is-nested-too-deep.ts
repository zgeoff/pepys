import { isRecord } from '@zgeoff/std';

export const maxNestingDepth = 64;

// Iterative: a recursive walk of a body of tens of thousands of nested arrays exhausts the stack.
export function isNestedTooDeep(value: unknown): boolean {
  const pending: { value: unknown; depth: number }[] = [{ value, depth: 0 }];

  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (Array.isArray(next.value) || isRecord(next.value)) {
      if (next.depth >= maxNestingDepth) {
        return true;
      }

      for (const item of Array.isArray(next.value) ? next.value : Object.values(next.value)) {
        pending.push({ value: item, depth: next.depth + 1 });
      }
    }
  }

  return false;
}

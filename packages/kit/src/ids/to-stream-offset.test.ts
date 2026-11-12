import { expect, test } from 'bun:test';
import { toStreamOffset } from './to-stream-offset.ts';
import type { StreamOffset } from './types.ts';

test('it gives a number as a stream offset, with the same value', () => {
  const offset: StreamOffset = toStreamOffset(7);

  expect<number>(offset).toBe(7);
});

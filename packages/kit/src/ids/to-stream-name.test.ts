import { expect, test } from 'bun:test';
import { defineFactFamily } from '../sources/define-fact-family.ts';
import { toStreamName } from './to-stream-name.ts';
import type { StreamName } from './types.ts';

test('it gives the declared stream of a family as a stream name, with the same text', () => {
  const family = defineFactFamily({
    stream: 'facts.tidewatch.reading',
    api: 'tidewatch/1',
    entityKind: 'tidewatch:gauge',
    types: {},
  });

  const stream: StreamName = toStreamName(family.stream);

  expect<string>(stream).toBe('facts.tidewatch.reading');
});

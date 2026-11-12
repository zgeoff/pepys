import { expect, test } from 'bun:test';
import type { StreamName } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import { collectStreamRanges } from './collect-stream-ranges.ts';
import type { StreamRange } from './collect-stream-ranges.ts';

test.each<[string, [string, number][], [string, number][], StreamRange[]]>([
  ['every stream is empty', [['facts.harbour.vessel', 0]], [], []],
  [
    'a stream has records and none applied',
    [['facts.harbour.vessel', 3]],
    [],
    [{ stream: toTagged<StreamName>('facts.harbour.vessel'), from: 0, tail: 3 }],
  ],
  [
    'a stream has records past the applied offset',
    [['facts.harbour.vessel', 5]],
    [['facts.harbour.vessel', 3]],
    [{ stream: toTagged<StreamName>('facts.harbour.vessel'), from: 3, tail: 5 }],
  ],
  [
    'a stream is applied up to its tail',
    [['facts.harbour.vessel', 3]],
    [['facts.harbour.vessel', 3]],
    [],
  ],
  [
    'one of two streams is applied up to its tail',
    [
      ['facts.harbour.vessel', 3],
      ['facts.harbour.berth', 2],
    ],
    [['facts.harbour.vessel', 3]],
    [{ stream: toTagged<StreamName>('facts.harbour.berth'), from: 0, tail: 2 }],
  ],
  [
    'two streams have new records',
    [
      ['facts.harbour.berth', 2],
      ['facts.harbour.vessel', 4],
    ],
    [['facts.harbour.vessel', 1]],
    [
      { stream: toTagged<StreamName>('facts.harbour.berth'), from: 0, tail: 2 },
      { stream: toTagged<StreamName>('facts.harbour.vessel'), from: 1, tail: 4 },
    ],
  ],
])('it collects the stream ranges to read when %s', (_title, tails, nextOffsets, ranges) => {
  const collected = collectStreamRanges(
    new Map(tails.map(([stream, tail]) => [toTagged<StreamName>(stream), tail])),
    new Map(nextOffsets.map(([stream, offset]) => [toTagged<StreamName>(stream), offset])),
  );

  expect(collected).toStrictEqual(ranges);
});

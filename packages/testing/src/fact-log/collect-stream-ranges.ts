import type { StreamName } from '@pepys/kit';

export interface StreamRange {
  stream: StreamName;
  from: number;
  tail: number;
}

// The records each stream holds past the offset the store applied up to, in the order of `tails`.
// A stream whose tail is that offset has nothing new, and no range.
export function collectStreamRanges(
  tails: ReadonlyMap<StreamName, number>,
  nextOffsets: ReadonlyMap<StreamName, number>,
): StreamRange[] {
  return [...tails].flatMap(([stream, tail]) => {
    const from = nextOffsets.get(stream) ?? 0;

    return tail === from ? [] : [{ stream, from, tail }];
  });
}

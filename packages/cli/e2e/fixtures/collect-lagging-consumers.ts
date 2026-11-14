interface ConsumerOffsets {
  name: string;
  stream: string;

  // the last sequence number the consumer applied from each stream, or null with no current
  // version
  offsets: readonly { stream: string; lastSeqNum: number }[] | null;
}

// The name of each consumer that has not applied the tail of its stream. The tail is the next
// sequence number, so a stream with a tail of 0 holds no fact, and every consumer of it is current.
export function collectLaggingConsumers(
  consumers: readonly ConsumerOffsets[],
  tails: ReadonlyMap<string, number>,
): string[] {
  return consumers
    .filter((entry) => {
      const tail = tails.get(entry.stream) ?? 0;

      if (tail === 0) {
        return false;
      }

      return !(entry.offsets ?? []).some(
        (offset) => offset.stream === entry.stream && offset.lastSeqNum === tail - 1,
      );
    })
    .map((entry) => entry.name);
}

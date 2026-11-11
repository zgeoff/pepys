import type { FactEnvelope } from '@pepys/kit';
import type { FactIndex } from './types.ts';

// The read of one scope, as the host serves it: every fact of the entity on `streams`, one per fact
// ID, sorted by time, then stream, then sequence number.
export function collectScopeFacts(
  index: FactIndex,
  scope: string,
  streams: readonly string[],
): FactEnvelope<unknown>[] {
  return [...index.firstCopies.values()]
    .filter((record) => record.envelope.entity === scope && streams.includes(record.stream))
    .map((record) => ({ record, sortKey: toSortKey(record.envelope.at) }))
    .toSorted(
      (left, right) =>
        compareText(left.sortKey, right.sortKey) ||
        compareText(left.record.stream, right.record.stream) ||
        left.record.seqNum - right.record.seqNum,
    )
    .map((entry) => entry.record.envelope);
}

// The host's sort key: the fraction of the seconds set to 9 digits, so text order is time order.
function toSortKey(at: string): string {
  const parts = /^(?<seconds>[^.]*T\d\d:\d\d:\d\d)(?:\.(?<fraction>\d+))?(?<zone>.*)$/u.exec(at);

  if (parts?.groups === undefined) {
    return at;
  }

  const fraction = (parts.groups['fraction'] ?? '').padEnd(9, '0').slice(0, 9);

  return `${parts.groups['seconds']}.${fraction}${parts.groups['zone']}`;
}

function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

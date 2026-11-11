import type { VersionHash } from '@pepys/kit';
import type { ConsumerVersion } from '@pepys/schema';
import { toTagged } from '@zgeoff/std';

// The SHA-256 of the module's hash, the pins and the manifest, as JSON with sorted keys. A changed
// index or link type with the same module bytes is therefore a new version.
export function buildVersionHash(
  parts: Pick<ConsumerVersion, 'module' | 'pins' | 'manifest'>,
): VersionHash {
  const text = JSON.stringify(toSortedValue(parts));

  return toTagged<VersionHash>(new Bun.CryptoHasher('sha256').update(text).digest('hex'));
}

function toSortedValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item: unknown) => toSortedValue(item));
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([first], [second]) => (first < second ? -1 : 1))
        .map(([key, item]: [string, unknown]) => [key, toSortedValue(item)]),
    );
  }

  return value;
}

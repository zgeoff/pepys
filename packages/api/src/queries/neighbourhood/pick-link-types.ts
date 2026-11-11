import type { LinkRegistry, Result } from '@pepys/kit';

interface LinkTypeChoice {
  linkTypes: readonly string[] | null;
  includeHubs: boolean;
}

interface UnknownLinkTypes {
  unknown: readonly string[];
  known: readonly string[];
}

// The link types a walk follows: the named ones, or every one, with a hub type only when the
// caller includes hubs.
export function pickLinkTypes(
  registry: LinkRegistry,
  choice: LinkTypeChoice,
): Result<readonly string[], UnknownLinkTypes> {
  const known = [...registry.keys()].toSorted();
  const named = choice.linkTypes ?? known;
  const unknown = [...new Set(named.filter((name) => !registry.has(name)))].toSorted();

  if (unknown.length > 0) {
    return { ok: false, failure: { unknown, known } };
  }

  const followed = named.filter((name) => choice.includeHubs || registry.get(name)?.hub === false);

  return { ok: true, value: [...new Set(followed)].toSorted() };
}

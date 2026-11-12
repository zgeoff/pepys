import type { ResyncMark } from '@pepys/kit';

// One marked object that the resync pull reads again: its repository, `owner/name`, its API path,
// and the digest of the last body ingest stored for it.
export interface ResyncTarget {
  kind: 'pull_request' | 'release';
  entity: string;
  repository: string;
  path: string;
  lastBodyDigest: string | undefined;
}

const locatorPatterns = [
  { kind: 'pull_request', pattern: /^\/repos\/(?<repository>[^/]+\/[^/]+)\/pulls\/\d+$/u },
  { kind: 'release', pattern: /^\/repos\/(?<repository>[^/]+\/[^/]+)\/releases\/\d+$/u },
] as const;

// The marks that the pull can read. A mark of another family, or with no locator, has nothing to
// read, so the pull leaves it out, and ingest removes it with the rest once the batch is stored.
export function collectResyncTargets(marks: readonly ResyncMark[]): ResyncTarget[] {
  return marks.flatMap((mark) => {
    const locator = mark.locator ?? '';

    for (const locatorPattern of locatorPatterns) {
      const repository = locatorPattern.pattern.exec(locator)?.groups?.['repository'];
      const kind = locatorPattern.kind;

      if (repository !== undefined && mark.entity.startsWith(`github:${kind}:`)) {
        return [
          {
            kind,
            entity: mark.entity,
            repository,
            path: locator,
            lastBodyDigest: mark.lastBodyDigest,
          },
        ];
      }
    }

    return [];
  });
}

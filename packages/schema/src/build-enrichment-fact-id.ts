import { toTagged } from '@zgeoff/std';
import { buildFactHash } from './build-fact-hash.ts';
import type { FactID } from './types.ts';

interface EnrichmentFactIDParts {
  job: string;
  jobVersion: string;
  inputHash: string;
}

export function buildEnrichmentFactID(parts: EnrichmentFactIDParts): FactID {
  const hash = buildFactHash([parts.job, parts.jobVersion, parts.inputHash]);

  return toTagged<FactID>(`enrichment:${hash}`);
}

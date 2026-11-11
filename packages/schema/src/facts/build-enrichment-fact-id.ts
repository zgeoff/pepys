import { toTagged } from '@zgeoff/std';
import type { FactID } from '../ids/types.ts';
import { buildFactHash } from './build-fact-hash.ts';

interface EnrichmentFactIDParts {
  job: string;
  jobVersion: string;
  inputHash: string;
}

export function buildEnrichmentFactID(parts: EnrichmentFactIDParts): FactID {
  const hash = buildFactHash([parts.job, parts.jobVersion, parts.inputHash]);

  return toTagged<FactID>(`enrichment:${hash}`);
}

export interface SpikeEvidence {
  forbiddenImports: string[];
  isEveryOutputEqual: boolean;
}

export function isSpikePassing(evidence: SpikeEvidence): boolean {
  return evidence.forbiddenImports.length === 0 && evidence.isEveryOutputEqual;
}

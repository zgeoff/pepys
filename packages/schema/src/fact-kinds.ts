// Each fact ID starts with its kind, so a source named like a kind could make a fact ID read as an
// entity ID.
export const factKinds = ['webhook', 'observation', 'enrichment', 'manual'] as const;

export interface SpikeEvidence {
  imports: string[];
  isEveryConstantClockOutputEqual: boolean;
  isDeterministic: boolean | undefined;
}

// The host binds the WASI clock to a constant, so a clock import alone passes.
const forbiddenImportPattern = /\.(?:random_|sock_)/u;

export function isSpikePassing(evidence: SpikeEvidence): boolean {
  return (
    !evidence.imports.some((name) => forbiddenImportPattern.test(name)) &&
    evidence.isEveryConstantClockOutputEqual &&
    evidence.isDeterministic === true
  );
}

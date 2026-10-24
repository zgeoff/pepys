export interface ShapeEvidence {
  runsFromRust: boolean;
  isEveryOutputEqual: boolean;
  isClockBound: boolean;
  servesRowRead: boolean;
  isGeneratorWritable: boolean;
}

export function isShapePassing(evidence: ShapeEvidence): boolean {
  return (
    evidence.runsFromRust &&
    evidence.isEveryOutputEqual &&
    evidence.isClockBound &&
    evidence.servesRowRead &&
    evidence.isGeneratorWritable
  );
}

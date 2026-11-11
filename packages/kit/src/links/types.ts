// What is wrong with one link that a consumer returns. The host has no deployment registry, so a
// type is declared by the consumer that writes it, or by nothing.
export type LinkProblem =
  | { kind: 'not-declared'; type: string; consumer: string }
  | { kind: 'not-an-entity-id'; end: 'from' | 'to'; id: string }
  | { kind: 'wrong-kind'; end: 'from' | 'to'; id: string; allowed: readonly string[] }
  | { kind: 'bad-confidence'; confidence: number }
  | { kind: 'no-evidence' };

// A consumer as its declaration or its manifest holds it, so the shared case file fits it too.
export interface LinkCheckConsumer {
  name: string;
  links: readonly { name: string; from: readonly string[]; to: readonly string[] }[];
}

export interface CheckedLink {
  type: string;
  from: string;
  to: string;
  confidence: number;
  evidence: string;
}

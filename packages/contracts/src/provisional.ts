// The repo's lint rule bans doc blocks, so a type carries the provisional mark instead of a tag: a
// search for this alias finds every contract that a spike's answer can still change.
export type Provisional<Spike extends UnrunSpike, Contract> = Contract & {
  readonly __provisional?: Spike;
};

export type UnrunSpike =
  | 'durable-streams-conformance'
  | 'jev-terms'
  | 'leaf-ir-bun'
  | 'mime-parsers'
  | 'orpc-elysia-v2'
  | 'parquet-escape-hatch'
  | 'source-retention';

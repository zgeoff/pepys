import type { BlobHash, EntityID, Result, VersionHash } from '@pepys/kit';

export interface Strategy {
  name: string;
  version: VersionHash;
}

export interface ExtractedMail {
  text: string;
  attachments: readonly { name: string; blob: BlobHash }[];
}

export type MimeTextExtractor = Strategy & {
  extract: (raw: Uint8Array) => Result<ExtractedMail, { reason: 'unparseable' | 'no-text' }>;
};

export interface Judgement<Choice extends string> {
  choice: Choice;
  probability: number;
}

export type MailClassifier<Label extends string> = Strategy & {
  labels: readonly Label[];
  classify: (text: string) => Promise<Result<Judgement<Label>, ModelFailure>>;
};

export interface JudgedText {
  id: EntityID;
  text: string;
}

export type PairJudge = Strategy & {
  judge: (
    subject: JudgedText,
    candidates: readonly JudgedText[],
  ) => Promise<Result<readonly PairJudgement[], ModelFailure>>;
};

export interface PairJudgement {
  candidate: EntityID;
  judgement: Judgement<'related' | 'unrelated' | 'unclear'>;
}

export interface CandidateProposer extends Strategy {
  propose: (entity: EntityID) => Promise<readonly EntityID[]>;
}

export type Embedder = Strategy & {
  model: string;
  dimensions: number;
  embed: (text: string) => Promise<Result<Float32Array, ModelFailure>>;
};

export interface Ranker extends Strategy {
  rank: (lists: readonly (readonly EntityID[])[]) => readonly EntityID[];
}

export type ModelFailure =
  | { reason: 'rate-limited'; retryAfterMs: number }
  | { reason: 'unavailable' }
  | { reason: 'rejected-answer'; detail: string };

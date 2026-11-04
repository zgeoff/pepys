import type { Result } from '@pepys/schema';
import type { BlobHash, EntityID, VersionHash } from './ids.ts';
import type { Provisional } from './provisional.ts';

// Every strategy carries the hash of its code, model, prompt and data files.
export interface Strategy {
  name: string;
  version: VersionHash;
}

export interface ExtractedMail {
  text: string;
  attachments: readonly { name: string; blob: BlobHash }[];
}

export type MimeTextExtractor = Provisional<
  'mime-parsers',
  Strategy & { extract: (raw: Uint8Array) => Result<ExtractedMail, { reason: 'unparseable' }> }
>;

// One choice from a set the caller defines, with a calibrated probability.
export interface Judgement<Choice extends string> {
  choice: Choice;
  probability: number;
}

export type MailClassifier<Label extends string> = Provisional<
  'jev-terms',
  Strategy & {
    labels: readonly Label[];
    classify: (text: string) => Promise<Result<Judgement<Label>, ModelFailure>>;
  }
>;

export interface JudgedText {
  id: EntityID;
  text: string;
}

// Each candidate pair gets its own judgement, because a subject can relate to several candidates.
// Jev takes many questions in one request, so one call judges every pair of a subject.
export type PairJudge = Provisional<
  'jev-terms',
  Strategy & {
    judge: (
      subject: JudgedText,
      candidates: readonly JudgedText[],
    ) => Promise<Result<readonly PairJudgement[], ModelFailure>>;
  }
>;

export interface PairJudgement {
  candidate: EntityID;
  judgement: Judgement<'related' | 'unrelated' | 'unclear'>;
}

// Proposes candidates for a pair judge, such as the nearest emails to an issue's text.
export interface CandidateProposer extends Strategy {
  propose: (entity: EntityID) => Promise<readonly EntityID[]>;
}

export type Embedder = Provisional<
  'leaf-ir-bun',
  Strategy & {
    model: string;
    dimensions: number;
    embed: (text: string) => Promise<Result<Float32Array, ModelFailure>>;
  }
>;

// Merges ranked result lists, such as full-text and vector results, into one ranking.
export interface Ranker extends Strategy {
  rank: (lists: readonly (readonly EntityID[])[]) => readonly EntityID[];
}

// A model call's expected failures. A rejected answer is one that fails its own output check.
export type ModelFailure =
  | { reason: 'rate-limited'; retryAfterMs: number }
  | { reason: 'unavailable' }
  | { reason: 'rejected-answer'; detail: string };

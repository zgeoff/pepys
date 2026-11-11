import type { Result, VersionHash } from '@pepys/kit';
import { match } from 'ts-pattern';
import type { JobDefinition, JobInput, JobOutcome } from '../jobs/job-definition.ts';
import type { Judgement } from '../strategies/types.ts';
import type {
  ChallengeFailure,
  EvaluationReport,
  PickBucket,
  PromotionOutcome,
  Sample,
  SubjectOf,
  VersionRecord,
} from './champion-challenger.ts';

type JobSubject = SubjectOf<'job'>;

interface MailText {
  text: string;
}

export interface LabelChallenger<Label extends string> {
  job: JobDefinition<MailText, Judgement<Label>>;
  challenger: VersionRecord<JobSubject>;
  pickBucket: PickBucket;
  runJob: (input: JobInput<MailText>) => Promise<JobOutcome>;
  evaluate: (
    subject: JobSubject,
    challenger: VersionHash,
  ) => Promise<Result<EvaluationReport<JobSubject>, ChallengeFailure>>;
  promote: (
    subject: JobSubject,
    challenger: VersionHash,
  ) => Promise<Result<PromotionOutcome, ChallengeFailure>>;
}

export type LabelChallengerOutcome =
  | { kind: 'refused'; failure: ChallengeFailure }
  | {
      kind: 'ran';
      outcomes: readonly JobOutcome[];
      report: Result<EvaluationReport<JobSubject>, ChallengeFailure>;
      promotion: Result<PromotionOutcome, ChallengeFailure>;
    };

export async function runLabelChallenger<Label extends string>(
  challenger: LabelChallenger<Label>,
  inputs: readonly JobInput<MailText>[],
): Promise<LabelChallengerOutcome> {
  const picked = pickChallengerInputs({
    sample: challenger.challenger.sample,
    inputs,
    pickBucket: challenger.pickBucket,
    modelCallsPerInput: challenger.job.version.modelCallsPerInput,
  });

  if (!picked.ok) {
    return { kind: 'refused', failure: picked.failure };
  }

  const record = challenger.challenger;

  const outcomes = await Promise.all(picked.value.map((input) => challenger.runJob(input)));
  const report = await challenger.evaluate(record.subject, record.version);
  const promotion = await challenger.promote(record.subject, record.version);

  return { kind: 'ran', outcomes, report, promotion };
}

interface ChallengerInputs<Value> {
  sample: Sample;
  inputs: readonly JobInput<Value>[];
  pickBucket: PickBucket;
  modelCallsPerInput: number;
}

type PickedInputs<Value> = Result<readonly JobInput<Value>[], ChallengeFailure>;

function pickChallengerInputs<Value>(options: ChallengerInputs<Value>): PickedInputs<Value> {
  return match(options.sample)
    .returnType<PickedInputs<Value>>()
    .with({ kind: 'all' }, () => ({ ok: true, value: options.inputs }))
    .with({ kind: 'buckets' }, (sample) => pickSampledInputs(sample, options))
    .exhaustive();
}

function pickSampledInputs<Value>(
  sample: Extract<Sample, { kind: 'buckets' }>,
  options: ChallengerInputs<Value>,
): PickedInputs<Value> {
  const sampled = options.inputs.filter((input) =>
    sample.buckets.includes(options.pickBucket(input.scope)),
  );

  const planned = sampled.length * options.modelCallsPerInput;

  if (planned > sample.modelCallCeiling) {
    return {
      ok: false,
      failure: { reason: 'over-model-call-ceiling', planned, ceiling: sample.modelCallCeiling },
    };
  }

  return { ok: true, value: sampled };
}

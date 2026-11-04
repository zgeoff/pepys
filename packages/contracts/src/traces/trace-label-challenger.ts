// Trace: a new email-labelling version runs as a challenger on a bucket of threads, the owner reads
// its report, and promotion rebuilds the consumers that read the job's facts. It only has to
// compile; no test runs it.
import type { Result } from '@pepys/schema';
import type {
  ChallengeFailure,
  ChampionChallenger,
  Evaluate,
  EvaluationReport,
  PickBucket,
  Promote,
  PromotionOutcome,
  SubjectOf,
  VersionRecord,
} from '../champion-challenger.ts';
import type { JobDefinition, JobInput, JobOutcome, JobPorts } from '../enrichment-job.ts';
import type { Judgement } from '../strategies.ts';

type Label = 'needs-reply' | 'receipt' | 'newsletter' | 'notification';

type Job = SubjectOf<'job'>;

export interface LabelChallengerTrace {
  champions: ChampionChallenger;
  job: JobDefinition<{ text: string }, Judgement<Label>>;
  challenger: VersionRecord<Job>;
  pickBucket: PickBucket;
  ports: JobPorts;
  runJob: (input: JobInput<{ text: string }>, ports: JobPorts) => Promise<JobOutcome>;
  evaluate: Evaluate;
  promote: Promote;
}

export async function runLabelChallengerTrace(
  trace: LabelChallengerTrace,
  inputs: readonly JobInput<{ text: string }>[],
): Promise<
  | { kind: 'refused'; failure: ChallengeFailure }
  | {
      kind: 'ran';
      outcomes: readonly JobOutcome[];
      report: Result<EvaluationReport<Job>, ChallengeFailure>;
      promotion: Result<PromotionOutcome, ChallengeFailure>;
    }
> {
  const sample = trace.challenger.sample;
  const subject = trace.challenger.subject;

  const sampled =
    sample.kind === 'all'
      ? inputs
      : inputs.filter((input) => sample.buckets.includes(trace.pickBucket(input.scope)));

  const planned = sampled.length * trace.job.version.modelCallsPerInput;

  if (sample.kind === 'buckets' && planned > sample.modelCallCeiling) {
    return {
      kind: 'refused',
      failure: { reason: 'over-model-call-ceiling', planned, ceiling: sample.modelCallCeiling },
    };
  }

  const outcomes = await Promise.all(sampled.map((input) => trace.runJob(input, trace.ports)));
  const report = await trace.evaluate(trace.champions, subject, trace.challenger.version);

  // The deployment's gate reads the report's score against its threshold; the trace asks nothing.
  const promotion = await trace.promote(trace.champions, subject, trace.challenger.version);

  return { kind: 'ran', outcomes, report, promotion };
}

// Trace: a new email-labelling version runs as a challenger on a bucket of threads, the owner reads
// its report, and promotion rebuilds the consumers that read the job's facts. It only has to
// compile; no test runs it.
import type {
  ChampionRecord,
  EvaluationReport,
  JobPromotionStep,
  PickBucket,
} from '../champion-challenger.ts';
import type {
  JobDefinition,
  JobInput,
  JobOutcome,
  JobPorts,
  RunConfiguration,
} from '../enrichment-job.ts';
import type { BucketNumber, VersionHash } from '../ids.ts';
import type { Judgement, MailClassifier } from '../strategies.ts';

type Label = 'needs-reply' | 'receipt' | 'newsletter' | 'notification';

export interface LabelChallengerTrace {
  champion: ChampionRecord;
  challengerJob: JobDefinition<{ text: string }, Judgement<Label>>;
  classifier: MailClassifier<Label>;
  configuration: RunConfiguration;
  pickBucket: PickBucket;
  ports: JobPorts;
  runJob: (input: JobInput<{ text: string }>, ports: JobPorts) => Promise<JobOutcome>;
  evaluate: (configuration: RunConfiguration) => Promise<EvaluationReport>;
  promote: (job: string, version: VersionHash) => readonly JobPromotionStep[];
}

export async function runLabelChallengerTrace(
  trace: LabelChallengerTrace,
  inputs: readonly JobInput<{ text: string }>[],
): Promise<{
  outcomes: readonly JobOutcome[];
  report: EvaluationReport;
  steps: readonly JobPromotionStep[];
}> {
  const challenger = trace.configuration.challenger;

  if (challenger === null) {
    return { outcomes: [], report: await trace.evaluate(trace.configuration), steps: [] };
  }

  const sampled = inputs.filter((input) =>
    isInBuckets(trace.pickBucket(input.scope), challenger.buckets),
  );

  const outcomes = await Promise.all(sampled.map((input) => trace.runJob(input, trace.ports)));
  const report = await trace.evaluate(trace.configuration);

  const passed =
    report.score.threshold === null || (report.score.value ?? 0) >= report.score.threshold;

  const steps = passed ? trace.promote(trace.challengerJob.name, challenger.version) : [];

  return { outcomes, report, steps };
}

function isInBuckets(bucket: BucketNumber, buckets: readonly BucketNumber[]): boolean {
  return buckets.includes(bucket);
}

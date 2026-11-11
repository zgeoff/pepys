import { parseFactEnvelope } from '@pepys/kit';
import type { Batch, SourceContext } from '@pepys/kit';

// Every fact is checked before any is written: its stream must be one of the source's families, and
// its envelope must parse.
export function findBatchProblem(source: SourceContext, batch: Batch): string | undefined {
  const streams = new Set<string>(source.families.map((family) => family.stream));

  for (const [index, pending] of batch.facts.entries()) {
    if (!streams.has(pending.stream)) {
      return `fact ${index}: the source ${source.name} has no stream ${pending.stream}`;
    }

    const envelope = parseFactEnvelope(pending.fact);

    if (!envelope.ok) {
      const issues = envelope.failure.issues.map(
        (issue) => `${issue.path.join('.')}: ${issue.message}`,
      );

      return `fact ${index} is not a valid envelope: ${issues.join('; ')}`;
    }
  }

  return undefined;
}

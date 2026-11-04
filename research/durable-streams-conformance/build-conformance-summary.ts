import { z } from 'zod';

export type Scope = 'read' | 'write' | 'out-of-scope';

export interface GroupSummary {
  readonly group: string;
  readonly scope: Scope;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
}

export interface ConformanceSummary {
  readonly totals: Record<Scope, { passed: number; failed: number; skipped: number }>;
  readonly groups: GroupSummary[];
  readonly failures: { readonly scope: Scope; readonly test: string; readonly message: string }[];
}

const assertionResultSchema = z.object({
  ancestorTitles: z.array(z.string()),
  title: z.string(),
  status: z.string(),
  failureMessages: z.array(z.string()),
});

const testFileSchema = z.object({ assertionResults: z.array(assertionResultSchema) });
const vitestReportSchema = z.object({ testResults: z.array(testFileSchema) });

export function buildConformanceSummary(reportText: string): ConformanceSummary {
  const report = vitestReportSchema.parse(JSON.parse(reportText));

  const groups = new Map<string, GroupSummary>();

  const failures: ConformanceSummary['failures'] = [];

  for (const result of report.testResults.flatMap((file) => file.assertionResults)) {
    const group = result.ancestorTitles.join(' > ');
    const scope = pickScope(group);
    const current = groups.get(group) ?? { group, scope, passed: 0, failed: 0, skipped: 0 };

    groups.set(group, {
      ...current,
      passed: current.passed + (result.status === 'passed' ? 1 : 0),
      failed: current.failed + (result.status === 'failed' ? 1 : 0),
      skipped: current.skipped + (result.status === 'passed' || result.status === 'failed' ? 0 : 1),
    });

    if (result.status === 'failed') {
      failures.push({
        scope,
        test: `${group} > ${result.title}`,
        message: (result.failureMessages[0] ?? '').split('\n')[0] ?? '',
      });
    }
  }

  const summaries = [...groups.values()];

  return {
    totals: {
      read: sumScope(summaries, 'read'),
      write: sumScope(summaries, 'write'),
      'out-of-scope': sumScope(summaries, 'out-of-scope'),
    },
    groups: summaries,
    failures,
  };
}

// The read subset, chosen by group name: each group whose assertions check a read response.
// The write groups test the stream creation and append side that pepys never serves. The
// out-of-scope groups test features pepys never needs: producers, forks, TTL and subscriptions.
const readGroups = new Set([
  'Read Operations',
  'Long-Poll Operations',
  'HEAD Metadata',
  'Offset Validation and Resumability',
  'Long-Poll Edge Cases',
  'Caching and ETag',
  'Chunking and Large Payloads',
  'Read-Your-Writes Consistency',
  'SSE Mode',
  'JSON Mode',
  'Browser Security Headers',
  'Stream Closure > Read Closed Streams (Catch-up)',
  'Stream Closure > Long-poll with Stream Closure',
  'Stream Closure > SSE with Stream Closure',
  'Stream Closure > HEAD with Stream Closure',
  'Property-Based Tests (fast-check) > Byte-Exactness Property',
  'Property-Based Tests (fast-check) > Immutability Properties',
  'Property-Based Tests (fast-check) > Offset Validation Properties',
  'Property-Based Tests (fast-check) > State Hash Verification',
]);

const outOfScopePatterns = [
  /Producer/u,
  /^Fork - /u,
  /TTL/u,
  /^Reserved subscription APIs/u,
  /^HEAD Metadata Edge Cases$/u,
];

function pickScope(group: string): Scope {
  if (readGroups.has(group)) {
    return 'read';
  }

  return outOfScopePatterns.some((pattern) => pattern.test(group)) ? 'out-of-scope' : 'write';
}

function sumScope(groups: readonly GroupSummary[], scope: Scope) {
  const inScope = groups.filter((group) => group.scope === scope);

  return {
    passed: inScope.reduce((sum, group) => sum + group.passed, 0),
    failed: inScope.reduce((sum, group) => sum + group.failed, 0),
    skipped: inScope.reduce((sum, group) => sum + group.skipped, 0),
  };
}

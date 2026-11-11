import { expect, mock, test } from 'bun:test';
import type { BucketNumber, EntityID, FactID, ScopeID, StreamName, VersionHash } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import type { JobInput, JobOutcome } from '../jobs/job-definition.ts';
import { runLabelChallenger } from './label-challenger.ts';

test('it refuses a sampled run whose planned model calls pass the ceiling, before any call', async () => {
  const runJob = mock((input: JobInput<{ text: string }>) =>
    Promise.resolve<JobOutcome>({
      kind: 'written',
      fact: toTagged<FactID>(`enrichment:${input.inputHash}`),
    }),
  );

  const outcome = await runLabelChallenger(
    {
      job: {
        name: 'mail_label',
        version: {
          job: 'mail_label',
          version: toTagged<VersionHash>('label-v2'),
          scoreThreshold: 0.8,
          modelCallsPerInput: 2,
        },
        resultStream: toTagged<StreamName>('facts.enrichment.mail_label'),
        trigger: {
          table: 'gmail_message',
          matches: () => true,
          toScope: (change) => toTagged<ScopeID>(change.key),
        },
        run: () => Promise.resolve({ ok: true, value: { choice: 'receipt', probability: 0.9 } }),
      },
      challenger: {
        subject: { kind: 'job', name: 'mail_label' },
        version: toTagged<VersionHash>('label-v2'),
        state: 'previewed',
        pins: {},
        sample: { kind: 'buckets', buckets: [toTagged<BucketNumber>(3)], modelCallCeiling: 3 },
      },
      pickBucket: (scope) =>
        new Map([
          [toTagged<ScopeID>('gmail:thread:1'), toTagged<BucketNumber>(3)],
          [toTagged<ScopeID>('gmail:thread:2'), toTagged<BucketNumber>(7)],
          [toTagged<ScopeID>('gmail:thread:3'), toTagged<BucketNumber>(3)],
        ]).get(scope) ?? toTagged<BucketNumber>(99),
      runJob,
      evaluate: () => Promise.resolve({ ok: false, failure: { reason: 'unknown-version' } }),
      promote: () => Promise.resolve({ ok: false, failure: { reason: 'unknown-version' } }),
    },
    [
      {
        scope: toTagged<ScopeID>('gmail:thread:1'),
        entity: toTagged<EntityID>('gmail:msg:11'),
        value: { text: 'Your receipt from the harbour shop' },
        inputHash: 'hash-1',
      },
      {
        scope: toTagged<ScopeID>('gmail:thread:2'),
        entity: toTagged<EntityID>('gmail:msg:21'),
        value: { text: 'Can you review the chart?' },
        inputHash: 'hash-2',
      },
      {
        scope: toTagged<ScopeID>('gmail:thread:3'),
        entity: toTagged<EntityID>('gmail:msg:31'),
        value: { text: 'The tide tables for November' },
        inputHash: 'hash-3',
      },
    ],
  );

  expect({ outcome, calls: runJob.mock.calls.length }).toStrictEqual({
    outcome: {
      kind: 'refused',
      failure: { reason: 'over-model-call-ceiling', planned: 4, ceiling: 3 },
    },
    calls: 0,
  });
});

test('it runs only the scopes in the challenger buckets, then reports and promotes', async () => {
  const runJob = mock((input: JobInput<{ text: string }>) =>
    Promise.resolve<JobOutcome>({
      kind: 'written',
      fact: toTagged<FactID>(`enrichment:${input.inputHash}`),
    }),
  );

  const outcome = await runLabelChallenger(
    {
      job: {
        name: 'mail_label',
        version: {
          job: 'mail_label',
          version: toTagged<VersionHash>('label-v2'),
          scoreThreshold: 0.8,
          modelCallsPerInput: 2,
        },
        resultStream: toTagged<StreamName>('facts.enrichment.mail_label'),
        trigger: {
          table: 'gmail_message',
          matches: () => true,
          toScope: (change) => toTagged<ScopeID>(change.key),
        },
        run: () => Promise.resolve({ ok: true, value: { choice: 'receipt', probability: 0.9 } }),
      },
      challenger: {
        subject: { kind: 'job', name: 'mail_label' },
        version: toTagged<VersionHash>('label-v2'),
        state: 'previewed',
        pins: {},
        sample: { kind: 'buckets', buckets: [toTagged<BucketNumber>(3)], modelCallCeiling: 10 },
      },
      pickBucket: (scope) =>
        new Map([
          [toTagged<ScopeID>('gmail:thread:1'), toTagged<BucketNumber>(3)],
          [toTagged<ScopeID>('gmail:thread:2'), toTagged<BucketNumber>(7)],
          [toTagged<ScopeID>('gmail:thread:3'), toTagged<BucketNumber>(3)],
        ]).get(scope) ?? toTagged<BucketNumber>(99),
      runJob,
      evaluate: () =>
        Promise.resolve({
          ok: true,
          value: {
            subject: { kind: 'job', name: 'mail_label' },
            champion: toTagged<VersionHash>('label-v1'),
            challenger: toTagged<VersionHash>('label-v2'),
            comparison: { kind: 'processed-scopes', scopes: [], sample: { kind: 'all' } },
            sections: [
              {
                kind: 'score',
                score: { source: 'label-corrections', value: 0.9, threshold: 0.8, support: 12 },
              },
            ],
          },
        }),
      promote: () => Promise.resolve({ ok: true, value: { kind: 'already-champion' } }),
    },
    [
      {
        scope: toTagged<ScopeID>('gmail:thread:1'),
        entity: toTagged<EntityID>('gmail:msg:11'),
        value: { text: 'Your receipt from the harbour shop' },
        inputHash: 'hash-1',
      },
      {
        scope: toTagged<ScopeID>('gmail:thread:2'),
        entity: toTagged<EntityID>('gmail:msg:21'),
        value: { text: 'Can you review the chart?' },
        inputHash: 'hash-2',
      },
      {
        scope: toTagged<ScopeID>('gmail:thread:3'),
        entity: toTagged<EntityID>('gmail:msg:31'),
        value: { text: 'The tide tables for November' },
        inputHash: 'hash-3',
      },
    ],
  );

  expect({ outcome, scopes: runJob.mock.calls.map(([input]) => input.scope) }).toStrictEqual({
    outcome: {
      kind: 'ran',
      outcomes: [
        { kind: 'written', fact: toTagged<FactID>('enrichment:hash-1') },
        { kind: 'written', fact: toTagged<FactID>('enrichment:hash-3') },
      ],
      report: {
        ok: true,
        value: {
          subject: { kind: 'job', name: 'mail_label' },
          champion: toTagged<VersionHash>('label-v1'),
          challenger: toTagged<VersionHash>('label-v2'),
          comparison: { kind: 'processed-scopes', scopes: [], sample: { kind: 'all' } },
          sections: [
            {
              kind: 'score',
              score: { source: 'label-corrections', value: 0.9, threshold: 0.8, support: 12 },
            },
          ],
        },
      },
      promotion: { ok: true, value: { kind: 'already-champion' } },
    },
    scopes: [toTagged<ScopeID>('gmail:thread:1'), toTagged<ScopeID>('gmail:thread:3')],
  });
});

test('it runs every input when the challenger samples all of them', async () => {
  const runJob = mock((input: JobInput<{ text: string }>) =>
    Promise.resolve<JobOutcome>({
      kind: 'written',
      fact: toTagged<FactID>(`enrichment:${input.inputHash}`),
    }),
  );

  await runLabelChallenger(
    {
      job: {
        name: 'mail_label',
        version: {
          job: 'mail_label',
          version: toTagged<VersionHash>('label-v2'),
          scoreThreshold: null,
          modelCallsPerInput: 2,
        },
        resultStream: toTagged<StreamName>('facts.enrichment.mail_label'),
        trigger: {
          table: 'gmail_message',
          matches: () => true,
          toScope: (change) => toTagged<ScopeID>(change.key),
        },
        run: () => Promise.resolve({ ok: true, value: { choice: 'receipt', probability: 0.9 } }),
      },
      challenger: {
        subject: { kind: 'job', name: 'mail_label' },
        version: toTagged<VersionHash>('label-v2'),
        state: 'previewed',
        pins: {},
        sample: { kind: 'all' },
      },
      pickBucket: () => toTagged<BucketNumber>(3),
      runJob,
      evaluate: () => Promise.resolve({ ok: false, failure: { reason: 'no-champion-input' } }),
      promote: () => Promise.resolve({ ok: false, failure: { reason: 'no-champion-input' } }),
    },
    [
      {
        scope: toTagged<ScopeID>('gmail:thread:1'),
        entity: toTagged<EntityID>('gmail:msg:11'),
        value: { text: 'Your receipt from the harbour shop' },
        inputHash: 'hash-1',
      },
      {
        scope: toTagged<ScopeID>('gmail:thread:2'),
        entity: toTagged<EntityID>('gmail:msg:21'),
        value: { text: 'Can you review the chart?' },
        inputHash: 'hash-2',
      },
    ],
  );

  expect(runJob.mock.calls.map(([input]) => input.scope)).toStrictEqual([
    toTagged<ScopeID>('gmail:thread:1'),
    toTagged<ScopeID>('gmail:thread:2'),
  ]);
});

import { expect, test } from 'bun:test';
import type { BlobHash, PendingFact, Result, StreamName } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import { buildTestFact } from '../test-utils/build-test-fact.ts';
import { pickBatchPlan } from './pick-batch-plan.ts';
import type { BatchRefusal } from './pick-batch-plan.ts';
import type { BatchPlan } from './plan-batch.ts';

test.each<[string, readonly PendingFact[], Result<BatchPlan, BatchRefusal>]>([
  [
    'every fact passes',
    [
      {
        stream: toTagged<StreamName>('facts.harbour.vessel'),
        fact: buildTestFact('event:x:1'),
        blobs: [],
      },
    ],
    {
      ok: true,
      value: new Map([
        [toTagged<StreamName>('facts.harbour.vessel'), [[buildTestFact('event:x:1')]]],
      ]),
    },
  ],
  [
    'a fact is on a stream the source lacks',
    [
      {
        stream: toTagged<StreamName>('facts.harbour.berth'),
        fact: buildTestFact('event:x:1'),
        blobs: [],
      },
    ],
    {
      ok: false,
      failure: {
        kind: 'bad-batch',
        reason: 'fact 0: the source harbour has no stream facts.harbour.berth',
      },
    },
  ],
  [
    'a fact is not a valid envelope',
    [
      {
        stream: toTagged<StreamName>('facts.harbour.vessel'),
        fact: { ...buildTestFact('event:x:1'), at: 'yesterday' },
        blobs: [],
      },
    ],
    {
      ok: false,
      failure: {
        kind: 'bad-batch',
        reason: expect.stringMatching(/^fact 0 is not a valid envelope: at: /u),
      },
    },
  ],
  [
    'a fact has a blob',
    [
      {
        stream: toTagged<StreamName>('facts.harbour.vessel'),
        fact: buildTestFact('event:x:1'),
        blobs: [{ hash: toTagged<BlobHash>('a'.repeat(64)), bytes: new Uint8Array([1]) }],
      },
    ],
    { ok: false, failure: { kind: 'has-blob', reason: 'ingest has no blob store' } },
  ],
  [
    'a bad stream and a blob are both present',
    [
      {
        stream: toTagged<StreamName>('facts.harbour.berth'),
        fact: buildTestFact('event:x:1'),
        blobs: [{ hash: toTagged<BlobHash>('a'.repeat(64)), bytes: new Uint8Array([1]) }],
      },
    ],
    {
      ok: false,
      failure: {
        kind: 'bad-batch',
        reason: 'fact 0: the source harbour has no stream facts.harbour.berth',
      },
    },
  ],
  [
    'a fact is larger than one append takes',
    [
      {
        stream: toTagged<StreamName>('facts.harbour.vessel'),
        fact: buildTestFact('event:x:1', { pad: 'x'.repeat(1_100_000) }),
        blobs: [],
      },
    ],
    {
      ok: false,
      failure: {
        kind: 'too-large',
        reason: 'one fact is larger than one append of the log takes',
      },
    },
  ],
])('it picks the plan of a batch when %s', (_title, facts, plan) => {
  const source = {
    name: 'harbour',
    families: [
      { stream: 'facts.harbour.vessel', api: 'pepys/1', entityKind: 'harbour:vessel', types: {} },
    ],
  } as const;

  expect(pickBatchPlan(source, { facts })).toStrictEqual(plan);
});

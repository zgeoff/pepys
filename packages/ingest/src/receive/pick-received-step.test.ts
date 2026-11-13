import { expect, test } from 'bun:test';
import type { BlobHash, Received, StreamName } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import { buildTestFact } from '../test-utils/build-test-fact.ts';
import { pickReceivedStep } from './pick-received-step.ts';
import type { ReceivedStep } from './pick-received-step.ts';

test.each<[string, Received | 'threw', ReceivedStep]>([
  [
    'the read threw',
    'threw',
    { kind: 'refuse', status: 500, reason: 'the source could not read the delivery' },
  ],
  [
    'the source refused the delivery',
    { kind: 'refused', status: 422, reason: 'no vessel in the body' },
    { kind: 'refuse', status: 422, reason: 'no vessel in the body' },
  ],
  ['the source ignored the delivery', { kind: 'ignored' }, { kind: 'ignore' }],
  ['the batch is empty', { kind: 'batch', batch: { facts: [] } }, { kind: 'ignore' }],
  [
    'the batch holds more facts than the limit',
    {
      kind: 'batch',
      batch: {
        facts: [
          {
            stream: toTagged<StreamName>('facts.harbour.vessel'),
            fact: buildTestFact('event:x:1'),
            blobs: [],
          },
          {
            stream: toTagged<StreamName>('facts.harbour.vessel'),
            fact: buildTestFact('event:x:2'),
            blobs: [],
          },
          {
            stream: toTagged<StreamName>('facts.harbour.vessel'),
            fact: buildTestFact('event:x:3'),
            blobs: [],
          },
        ],
      },
    },
    { kind: 'refuse', status: 413, reason: 'a batch holds 2 facts at most' },
  ],
  [
    'the batch is over the limit and on a stream the source lacks',
    {
      kind: 'batch',
      batch: {
        facts: [
          {
            stream: toTagged<StreamName>('facts.harbour.berth'),
            fact: buildTestFact('event:x:1'),
            blobs: [],
          },
          {
            stream: toTagged<StreamName>('facts.harbour.berth'),
            fact: buildTestFact('event:x:2'),
            blobs: [],
          },
          {
            stream: toTagged<StreamName>('facts.harbour.berth'),
            fact: buildTestFact('event:x:3'),
            blobs: [],
          },
        ],
      },
    },
    { kind: 'refuse', status: 413, reason: 'a batch holds 2 facts at most' },
  ],
  [
    'a fact is on a stream the source lacks',
    {
      kind: 'batch',
      batch: {
        facts: [
          {
            stream: toTagged<StreamName>('facts.harbour.berth'),
            fact: buildTestFact('event:x:1'),
            blobs: [],
          },
        ],
      },
    },
    {
      kind: 'refuse',
      status: 422,
      reason: 'fact 0: the source harbour has no stream facts.harbour.berth',
    },
  ],
  [
    'a fact has a blob',
    {
      kind: 'batch',
      batch: {
        facts: [
          {
            stream: toTagged<StreamName>('facts.harbour.vessel'),
            fact: buildTestFact('event:x:1'),
            blobs: [{ hash: toTagged<BlobHash>('a'.repeat(64)), bytes: new Uint8Array([1]) }],
          },
        ],
      },
    },
    { kind: 'has-blob' },
  ],
  [
    'a fact is larger than one append takes',
    {
      kind: 'batch',
      batch: {
        facts: [
          {
            stream: toTagged<StreamName>('facts.harbour.vessel'),
            fact: buildTestFact('event:x:1', { pad: 'x'.repeat(1_100_000) }),
            blobs: [],
          },
        ],
      },
    },
    {
      kind: 'refuse',
      status: 413,
      reason: 'one fact is larger than one append of the log takes',
    },
  ],
  [
    'every fact passes',
    {
      kind: 'batch',
      batch: {
        facts: [
          {
            stream: toTagged<StreamName>('facts.harbour.vessel'),
            fact: buildTestFact('event:x:1'),
            blobs: [],
          },
        ],
      },
    },
    {
      kind: 'write',
      facts: [
        {
          stream: toTagged<StreamName>('facts.harbour.vessel'),
          fact: buildTestFact('event:x:1'),
          blobs: [],
        },
      ],
      plan: new Map([
        [toTagged<StreamName>('facts.harbour.vessel'), [[buildTestFact('event:x:1')]]],
      ]),
    },
  ],
])('it picks the step after the read of a delivery when %s', (_title, received, step) => {
  const source = {
    name: 'harbour',
    families: [
      { stream: 'facts.harbour.vessel', api: 'pepys/1', entityKind: 'harbour:vessel', types: {} },
    ],
  } as const;

  expect(pickReceivedStep(source, received, 2)).toStrictEqual(step);
});

import { expect, test } from 'bun:test';
import type { EntityID, FactID, StreamName, StreamOffset } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import invariant from 'tiny-invariant';
import { createMemoryFactLog } from './create-memory-fact-log.ts';

test('it reports an unknown outcome for an append whose reply is lost', async () => {
  const log = createMemoryFactLog([toTagged<StreamName>('facts.manual.link')]);

  log.loseNextReply();

  const outcome = await log.append(
    toTagged<StreamName>('facts.manual.link'),
    {
      id: toTagged<FactID>(`manual:${'a'.repeat(64)}`),
      type: 'link.asserted',
      v: 1,
      api: 'pepys/1',
      entity: toTagged<EntityID>('gmail:msg:17'),
      at: '2026-10-01T08:00:00Z',
      payload: {},
    },
    toTagged<StreamOffset>(0),
  );

  expect(outcome).toStrictEqual({ kind: 'unknown' });
});

test('it stores an append whose reply is lost', async () => {
  const log = createMemoryFactLog([toTagged<StreamName>('facts.manual.link')]);

  log.loseNextReply();

  await log.append(
    toTagged<StreamName>('facts.manual.link'),
    {
      id: toTagged<FactID>(`manual:${'a'.repeat(64)}`),
      type: 'link.asserted',
      v: 1,
      api: 'pepys/1',
      entity: toTagged<EntityID>('gmail:msg:17'),
      at: '2026-10-01T08:00:00Z',
      payload: {},
    },
    toTagged<StreamOffset>(0),
  );

  const tail = await log.readTail(toTagged<StreamName>('facts.manual.link'));

  expect(tail).toStrictEqual({ ok: true, value: toTagged<StreamOffset>(1) });
});

test('it rejects a repeat of an append whose reply is lost as a tail mismatch', async () => {
  const log = createMemoryFactLog([toTagged<StreamName>('facts.manual.link')]);

  const fact = {
    id: toTagged<FactID>(`manual:${'a'.repeat(64)}`),
    type: 'link.asserted',
    v: 1,
    api: 'pepys/1',
    entity: toTagged<EntityID>('gmail:msg:17'),
    at: '2026-10-01T08:00:00Z',
    payload: {},
  } as const;

  log.loseNextReply();

  await log.append(toTagged<StreamName>('facts.manual.link'), fact, toTagged<StreamOffset>(0));

  const outcome = await log.append(
    toTagged<StreamName>('facts.manual.link'),
    fact,
    toTagged<StreamOffset>(0),
  );

  expect(outcome).toStrictEqual({ kind: 'rejected', reason: 'tail-mismatch' });
});

test('it keeps a stored fact as appended when the caller changes the envelope afterwards', async () => {
  const log = createMemoryFactLog([toTagged<StreamName>('facts.manual.link')]);

  const fact = {
    id: toTagged<FactID>(`manual:${'a'.repeat(64)}`),
    type: 'link.asserted',
    v: 1,
    api: 'pepys/1',
    entity: toTagged<EntityID>('gmail:msg:17'),
    at: '2026-10-01T08:00:00Z',
    payload: { evidence: 'the email quotes the issue title' },
  } as const;

  await log.append(toTagged<StreamName>('facts.manual.link'), fact, toTagged<StreamOffset>(0));

  const changed: { evidence: string } = fact.payload;

  changed.evidence = 'rewritten';

  const read = await log.read(
    toTagged<StreamName>('facts.manual.link'),
    toTagged<StreamOffset>(0),
    1,
  );

  invariant(read.ok);

  expect(read.value[0]?.fact.payload).toStrictEqual({
    evidence: 'the email quotes the issue title',
  });
});

test('it keeps a stored fact as appended when a reader changes what it read', async () => {
  const log = createMemoryFactLog([toTagged<StreamName>('facts.manual.link')]);

  await log.append(
    toTagged<StreamName>('facts.manual.link'),
    {
      id: toTagged<FactID>(`manual:${'a'.repeat(64)}`),
      type: 'link.asserted',
      v: 1,
      api: 'pepys/1',
      entity: toTagged<EntityID>('gmail:msg:17'),
      at: '2026-10-01T08:00:00Z',
      payload: { evidence: 'the email quotes the issue title' },
    },
    toTagged<StreamOffset>(0),
  );

  const first = await log.read(
    toTagged<StreamName>('facts.manual.link'),
    toTagged<StreamOffset>(0),
    1,
  );

  invariant(first.ok && first.value[0] !== undefined);

  first.value[0].fact.type = 'link.retracted';

  const second = await log.read(
    toTagged<StreamName>('facts.manual.link'),
    toTagged<StreamOffset>(0),
    1,
  );

  invariant(second.ok);

  expect(second.value[0]?.fact.type).toBe('link.asserted');
});

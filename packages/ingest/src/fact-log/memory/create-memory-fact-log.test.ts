import { expect, test } from 'bun:test';
import type { EntityID, FactID, StreamName, StreamOffset } from '@pepys/schema';
import { toTagged } from '@zgeoff/std';
import invariant from 'tiny-invariant';
import { createMemoryFactLog } from './create-memory-fact-log.ts';

test('it acknowledges each append at the next offset of its stream', async () => {
  const log = createMemoryFactLog([toTagged<StreamName>('facts.manual.link')]);

  await log.append(toTagged<StreamName>('facts.manual.link'), {
    id: toTagged<FactID>('manual:aa'),
    type: 'link.asserted',
    v: 1,
    api: 'pepys/1',
    entity: toTagged<EntityID>('gmail:msg:17'),
    at: '2026-10-01T08:00:00Z',
    payload: {},
  });

  const outcome = await log.append(toTagged<StreamName>('facts.manual.link'), {
    id: toTagged<FactID>('manual:bb'),
    type: 'link.retracted',
    v: 1,
    api: 'pepys/1',
    entity: toTagged<EntityID>('gmail:msg:17'),
    at: '2026-10-01T09:00:00Z',
    payload: {},
  });

  expect(outcome).toStrictEqual({ kind: 'acknowledged', offset: toTagged<StreamOffset>(1) });
});

test('it rejects an append to a stream it does not hold', async () => {
  const log = createMemoryFactLog([toTagged<StreamName>('facts.manual.link')]);

  const outcome = await log.append(toTagged<StreamName>('facts.github.pull_request'), {
    id: toTagged<FactID>('manual:aa'),
    type: 'link.asserted',
    v: 1,
    api: 'pepys/1',
    entity: toTagged<EntityID>('gmail:msg:17'),
    at: '2026-10-01T08:00:00Z',
    payload: {},
  });

  expect(outcome).toStrictEqual({ kind: 'rejected', reason: 'unknown-stream' });
});

test('it reads up to the count of facts from an offset, in append order', async () => {
  const log = createMemoryFactLog([toTagged<StreamName>('facts.manual.link')]);

  for (const id of ['manual:aa', 'manual:bb', 'manual:cc']) {
    await log.append(toTagged<StreamName>('facts.manual.link'), {
      id: toTagged<FactID>(id),
      type: 'link.asserted',
      v: 1,
      api: 'pepys/1',
      entity: toTagged<EntityID>('gmail:msg:17'),
      at: '2026-10-01T08:00:00Z',
      payload: {},
    });
  }

  const read = await log.read(
    toTagged<StreamName>('facts.manual.link'),
    toTagged<StreamOffset>(1),
    1,
  );

  expect(read).toStrictEqual({
    ok: true,
    value: [
      {
        offset: toTagged<StreamOffset>(1),
        fact: {
          id: toTagged<FactID>('manual:bb'),
          type: 'link.asserted',
          v: 1,
          api: 'pepys/1',
          entity: toTagged<EntityID>('gmail:msg:17'),
          at: '2026-10-01T08:00:00Z',
          payload: {},
        },
      },
    ],
  });
});

test('it keeps a stored fact as appended when the caller changes the envelope afterwards', async () => {
  const log = createMemoryFactLog([toTagged<StreamName>('facts.manual.link')]);

  const fact = {
    id: toTagged<FactID>('manual:aa'),
    type: 'link.asserted',
    v: 1,
    api: 'pepys/1',
    entity: toTagged<EntityID>('gmail:msg:17'),
    at: '2026-10-01T08:00:00Z',
    payload: { evidence: 'the email quotes the issue title' },
  } as const;

  await log.append(toTagged<StreamName>('facts.manual.link'), fact);

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

  await log.append(toTagged<StreamName>('facts.manual.link'), {
    id: toTagged<FactID>('manual:aa'),
    type: 'link.asserted',
    v: 1,
    api: 'pepys/1',
    entity: toTagged<EntityID>('gmail:msg:17'),
    at: '2026-10-01T08:00:00Z',
    payload: { evidence: 'the email quotes the issue title' },
  });

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

test('it reads an empty list at the tail', async () => {
  const log = createMemoryFactLog([toTagged<StreamName>('facts.manual.link')]);

  const read = await log.read(
    toTagged<StreamName>('facts.manual.link'),
    toTagged<StreamOffset>(0),
    10,
  );

  expect(read).toStrictEqual({ ok: true, value: [] });
});

test('it reads the tail as the offset of the next append', async () => {
  const log = createMemoryFactLog([toTagged<StreamName>('facts.manual.link')]);

  await log.append(toTagged<StreamName>('facts.manual.link'), {
    id: toTagged<FactID>('manual:aa'),
    type: 'link.asserted',
    v: 1,
    api: 'pepys/1',
    entity: toTagged<EntityID>('gmail:msg:17'),
    at: '2026-10-01T08:00:00Z',
    payload: {},
  });

  const tail = await log.readTail(toTagged<StreamName>('facts.manual.link'));

  expect(tail).toStrictEqual({ ok: true, value: toTagged<StreamOffset>(1) });
});

test('it answers unknown-stream to a read of a stream it does not hold', async () => {
  const log = createMemoryFactLog([toTagged<StreamName>('facts.manual.link')]);

  const read = await log.read(
    toTagged<StreamName>('facts.github.pull_request'),
    toTagged<StreamOffset>(0),
    10,
  );

  expect(read).toStrictEqual({ ok: false, failure: { reason: 'unknown-stream' } });
});

test('it answers unknown-stream to a tail read of a stream it does not hold', async () => {
  const log = createMemoryFactLog([toTagged<StreamName>('facts.manual.link')]);

  const tail = await log.readTail(toTagged<StreamName>('facts.github.pull_request'));

  expect(tail).toStrictEqual({ ok: false, failure: { reason: 'unknown-stream' } });
});

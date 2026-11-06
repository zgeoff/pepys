import { expect, test } from 'bun:test';
import { call, implement } from '@orpc/server';
import type { FactID } from '@pepys/schema';
import { toTagged } from '@zgeoff/std';
import { coreContract } from './core-contract.ts';

function setupTest() {
  const assertLink = implement(coreContract).assert_link.handler(() => ({ fact: 'manual:aa' }));

  return { assertLink };
}

test('it refuses an assert link with empty evidence at the input schema', () => {
  const ctx = setupTest();

  expect(
    call(ctx.assertLink, {
      requestID: 'request-1',
      type: 'mentions',
      from: 'gmail:msg:17',
      to: { kind: 'entity', id: 'github:issue:412' },
      confidence: 0.4,
      evidence: '',
    }),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
});

test.each([1.2, -0.1])('it refuses an assert link whose confidence is %d', (confidence) => {
  const ctx = setupTest();

  expect(
    call(ctx.assertLink, {
      requestID: 'request-1',
      type: 'mentions',
      from: 'gmail:msg:17',
      to: { kind: 'entity', id: 'github:issue:412' },
      confidence,
      evidence: 'the email quotes the issue title',
    }),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
});

test('it accepts an assert link with confidence 0.4 from any client', () => {
  const ctx = setupTest();

  expect(
    call(ctx.assertLink, {
      requestID: 'request-1',
      type: 'mentions',
      from: 'gmail:msg:17',
      to: { kind: 'entity', id: 'github:issue:412' },
      confidence: 0.4,
      evidence: 'the email quotes the issue title',
    }),
  ).resolves.toStrictEqual({ fact: toTagged<FactID>('manual:aa') });
});

test('it refuses an assert link whose source is not an entity ID', () => {
  const ctx = setupTest();

  expect(
    call(ctx.assertLink, {
      requestID: 'request-1',
      type: 'mentions',
      from: 'harbour',
      to: { kind: 'entity', id: 'github:issue:412' },
      confidence: 0.4,
      evidence: 'the email quotes the issue title',
    }),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
});

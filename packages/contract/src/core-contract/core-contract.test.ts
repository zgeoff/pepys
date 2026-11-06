import { expect, test } from 'bun:test';
import { call, implement } from '@orpc/server';
import type { FactID } from '@pepys/schema';
import { toTagged } from '@zgeoff/std';
import { coreContract } from './core-contract.ts';

function setupTest() {
  const contract = implement(coreContract);
  const assertLink = contract.assert_link.handler(() => ({ fact: 'manual:aa' }));
  const retractLink = contract.retract_link.handler(() => ({ fact: 'manual:bb' }));
  const correctLabel = contract.correct_label.handler(() => ({ fact: 'manual:cc' }));

  return { assertLink, retractLink, correctLabel };
}

test.each([
  { procedure: 'get_entity', codes: ['NOT_FOUND'] },
  { procedure: 'neighbourhood', codes: ['NOT_IMPLEMENTED'] },
  { procedure: 'search', codes: ['NOT_IMPLEMENTED'] },
  { procedure: 'entity_history', codes: ['NOT_IMPLEMENTED'] },
  { procedure: 'assert_link', codes: ['NOT_IMPLEMENTED', 'UNPROCESSABLE_CONTENT'] },
  { procedure: 'retract_link', codes: ['NOT_IMPLEMENTED'] },
  { procedure: 'correct_label', codes: ['NOT_IMPLEMENTED'] },
] as const)('it declares the errors $codes on $procedure', (row) => {
  expect(coreContract[row.procedure]['~orpc'].errorMap).toContainAllKeys([...row.codes]);
});

test.each([
  { procedure: 'get_entity', code: 'NOT_FOUND', status: 404 },
  { procedure: 'neighbourhood', code: 'NOT_IMPLEMENTED', status: 501 },
  { procedure: 'search', code: 'NOT_IMPLEMENTED', status: 501 },
  { procedure: 'entity_history', code: 'NOT_IMPLEMENTED', status: 501 },
  { procedure: 'assert_link', code: 'NOT_IMPLEMENTED', status: 501 },
  { procedure: 'assert_link', code: 'UNPROCESSABLE_CONTENT', status: 422 },
  { procedure: 'retract_link', code: 'NOT_IMPLEMENTED', status: 501 },
  { procedure: 'correct_label', code: 'NOT_IMPLEMENTED', status: 501 },
] as const)('it gives $code on $procedure the HTTP status $status', (row) => {
  const errorMap: Readonly<Record<string, { status?: number } | undefined>> =
    coreContract[row.procedure]['~orpc'].errorMap;

  expect(errorMap[row.code]?.status).toBe(row.status);
});

test('it refuses an assert link with an empty request ID', () => {
  const ctx = setupTest();

  expect(
    call(ctx.assertLink, {
      requestID: '',
      type: 'mentions',
      from: 'gmail:msg:17',
      to: { kind: 'entity', id: 'github:issue:412' },
      confidence: 0.4,
      evidence: 'the email quotes the issue title',
    }),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
});

test('it refuses a retract link with an empty request ID', () => {
  const ctx = setupTest();

  expect(
    call(ctx.retractLink, {
      requestID: '',
      type: 'mentions',
      from: 'gmail:msg:17',
      to: { kind: 'entity', id: 'github:issue:412' },
      reason: 'the email quotes another issue',
    }),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
});

test('it refuses a correct label with an empty request ID', () => {
  const ctx = setupTest();

  expect(
    call(ctx.correctLabel, {
      requestID: '',
      entity: 'gmail:msg:17',
      job: 'mail_label',
      label: 'receipt',
    }),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
});

test('it accepts a retract link and a correct label with a request ID', async () => {
  const ctx = setupTest();

  const results = await Promise.all([
    call(ctx.retractLink, {
      requestID: 'request-2',
      type: 'mentions',
      from: 'gmail:msg:17',
      to: { kind: 'entity', id: 'github:issue:412' },
      reason: 'the email quotes another issue',
    }),
    call(ctx.correctLabel, {
      requestID: 'request-3',
      entity: 'gmail:msg:17',
      job: 'mail_label',
      label: 'receipt',
    }),
  ]);

  expect(results).toStrictEqual([
    { fact: toTagged<FactID>('manual:bb') },
    { fact: toTagged<FactID>('manual:cc') },
  ]);
});

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

import { expect, test } from 'bun:test';
import { planAppends } from './plan-appends.ts';
import { buildTestFact } from './test-utils/build-test-fact.ts';

test('it plans no run for no facts', () => {
  expect(planAppends([])).toStrictEqual({ ok: true, value: [] });
});

test('it keeps 1000 small facts in one run', () => {
  const facts = Array.from({ length: 1000 }, (_, index) => buildTestFact(`event:x:${index}`));
  const planned = planAppends(facts);

  expect(planned.ok && planned.value.map((run) => run.length)).toStrictEqual([1000]);
});

test('it cuts 1001 small facts into a run of 1000 and a run of 1', () => {
  const facts = Array.from({ length: 1001 }, (_, index) => buildTestFact(`event:x:${index}`));
  const planned = planAppends(facts);

  expect(planned.ok && planned.value.map((run) => run.length)).toStrictEqual([1000, 1]);
});

test('it cuts a run that the next fact would push over 1 MiB, in order', () => {
  const pad = { pad: 'x'.repeat(400_000) };

  const planned = planAppends([
    buildTestFact('event:x:1', pad),
    buildTestFact('event:x:2', pad),
    buildTestFact('event:x:3', pad),
    buildTestFact('event:x:4'),
  ]);

  expect(
    planned.ok && planned.value.map((run) => run.map((fact): string => fact.id)),
  ).toStrictEqual([
    ['event:x:1', 'event:x:2'],
    ['event:x:3', 'event:x:4'],
  ]);
});

test('it reports the index of a fact that no append can hold', () => {
  const planned = planAppends([
    buildTestFact('event:x:1'),
    buildTestFact('event:x:2', { pad: 'x'.repeat(1_048_576) }),
  ]);

  expect(planned).toStrictEqual({ ok: false, failure: { reason: 'too-large', index: 1 } });
});

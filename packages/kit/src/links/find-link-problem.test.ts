import { expect, test } from 'bun:test';
import { findLinkProblem } from './find-link-problem.ts';
import linkCases from './link-check-cases.json' with { type: 'json' };

// The host's Rust link check runs the same cases, so the two checks cannot drift apart unseen.
test.each(linkCases.cases.map((linkCase) => [linkCase.title, linkCase] as const))(
  'it %s, in the shared link cases',
  (_title, linkCase) => {
    const problem = findLinkProblem(linkCases.consumer, linkCase.link);

    expect<string | null>(problem?.kind ?? null).toBe(linkCase.problem);
  },
);

test('it names the end, the ID and the allowed kinds of a wrong kind', () => {
  const consumer = {
    name: 'archive_shelf',
    links: [{ name: 'holds', from: ['archive:shelf'], to: ['archive:box'] }],
  };

  const problem = findLinkProblem(consumer, {
    type: 'holds',
    from: 'archive:shelf:s-1',
    to: 'archive:room:r-1',
    confidence: 1,
    evidence: 'event:archive:e-1',
  });

  expect(problem).toStrictEqual({
    kind: 'wrong-kind',
    end: 'to',
    id: 'archive:room:r-1',
    allowed: ['archive:box'],
  });
});

test('it names the type and the consumer of an undeclared link', () => {
  const problem = findLinkProblem(
    { name: 'archive_shelf', links: [] },
    {
      type: 'holds',
      from: 'archive:shelf:s-1',
      to: 'archive:box:b-1',
      confidence: 1,
      evidence: 'event:archive:e-1',
    },
  );

  expect(problem).toStrictEqual({ kind: 'not-declared', type: 'holds', consumer: 'archive_shelf' });
});

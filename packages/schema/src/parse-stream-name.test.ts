import { expect, test } from 'bun:test';
import { parseStreamName } from './parse-stream-name.ts';

test('it parses a fact stream name into its source and family', () => {
  expect(parseStreamName('facts.github.pull_request')).toStrictEqual({
    ok: true,
    value: { source: 'github', family: 'pull_request' },
  });
});

test.each([
  ['a name with no prefix', 'github.pull_request', 'malformed'],
  ['a prefix other than facts', 'events.github.pull_request', 'malformed'],
  ['a name with a fourth part', 'facts.github.pull_request.v2', 'malformed'],
  ['an empty source', 'facts..pull_request', 'invalid-source'],
  ['an uppercase source', 'facts.GitHub.pull_request', 'invalid-source'],
  ['an empty family', 'facts.github.', 'invalid-family'],
  ['a family with a dash', 'facts.github.pull-request', 'invalid-family'],
])('it refuses %s', (_label, text, reason) => {
  const actual: unknown = parseStreamName(text);

  expect(actual).toStrictEqual({ ok: false, failure: { reason } });
});

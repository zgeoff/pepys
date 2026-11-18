import { expect, test } from 'bun:test';
import { parseSpoolLine } from './parse-spool-line.ts';

test.each([
  ['text that is no JSON', 'not json', 'not json', 'the line does not parse as JSON'],
  ['a JSON array', '[1]', [1], 'the line is not a JSON object'],
  ['a line with no path', '{"body":{}}', { body: {} }, 'the line has no path /v1/logs'],
  [
    'a line for another path',
    '{"path":"/v1/metrics","body":{}}',
    { path: '/v1/metrics', body: {} },
    'the line has no path /v1/logs',
  ],
  [
    'a line whose body is text',
    '{"path":"/v1/logs","body":"x"}',
    { path: '/v1/logs', body: 'x' },
    'the line has no body object',
  ],
  [
    'a line whose body is null',
    '{"path":"/v1/logs","body":null}',
    { path: '/v1/logs', body: null },
    'the line has no body object',
  ],
])('#parseSpoolLine marks %s as unsendable', (_name, text, line, reason) => {
  expect(parseSpoolLine(text)).toStrictEqual({ kind: 'unsendable', line, reason });
});

test('#parseSpoolLine sends the body of a line and checks no other field', () => {
  const parsed = parseSpoolLine('{"path":"/v1/logs","body":{"resourceLogs":[]},"extra":1}');

  expect(parsed).toStrictEqual({
    kind: 'sendable',
    requestBody: '{"resourceLogs":[]}',
    line: { path: '/v1/logs', body: { resourceLogs: [] }, extra: 1 },
  });
});

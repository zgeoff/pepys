import { expect, test } from 'bun:test';
import { parseAnswerReason } from './parse-answer-reason.ts';

test.each([
  [
    'an ingest answer',
    '{"error":"the body is no OTLP logs export"}',
    'the body is no OTLP logs export',
  ],
  ['text that is no JSON', 'Bad Gateway', 'Bad Gateway'],
  ['JSON with no error', '{"message":"x"}', '{"message":"x"}'],
])('#parseAnswerReason reads %s', (_name, text, reason) => {
  expect(parseAnswerReason(text)).toBe(reason);
});

test('#parseAnswerReason cuts a long reason to 500 characters', () => {
  expect(parseAnswerReason('x'.repeat(900))).toHaveLength(500);
});

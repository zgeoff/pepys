import { expect, test } from 'bun:test';
import { pickAnswerAction, pickNextRetryWait } from './pick-answer-action.ts';

test.each([
  [200, 0, { move: 'sent', state: 'sending', wait: 'none', serverErrors: 0 }],
  [204, 2, { move: 'sent', state: 'sending', wait: 'none', serverErrors: 0 }],
  [400, 0, { move: 'failed', state: 'sending', wait: 'none', serverErrors: 0 }],
  [413, 0, { move: 'failed', state: 'sending', wait: 'none', serverErrors: 0 }],
  [415, 0, { move: 'failed', state: 'sending', wait: 'none', serverErrors: 0 }],
  [422, 0, { move: 'failed', state: 'sending', wait: 'none', serverErrors: 0 }],
  [500, 0, { move: 'stay', state: 'stopped', wait: 'slow', serverErrors: 1 }],
  [500, 2, { move: 'stay', state: 'stopped', wait: 'slow', serverErrors: 3 }],
  [500, 3, { move: 'failed', state: 'stopped', wait: 'none', serverErrors: 0 }],
  [401, 1, { move: 'stay', state: 'stopped', wait: 'slow', serverErrors: 1 }],
  [403, 0, { move: 'stay', state: 'stopped', wait: 'slow', serverErrors: 0 }],
  [404, 0, { move: 'stay', state: 'stopped', wait: 'slow', serverErrors: 0 }],
  [503, 1, { move: 'stay', state: 'waiting', wait: 'backoff', serverErrors: 1 }],
  [429, 0, { move: 'stay', state: 'waiting', wait: 'backoff', serverErrors: 0 }],
  [301, 0, { move: 'stay', state: 'waiting', wait: 'backoff', serverErrors: 0 }],
  [null, 0, { move: 'stay', state: 'waiting', wait: 'backoff', serverErrors: 0 }],
] as const)(
  '#pickAnswerAction maps the answer %p after %p 500 answers to %p',
  (status, errors, action) => {
    expect(pickAnswerAction(status, errors)).toStrictEqual(action);
  },
);

test.each([
  [1000, 2000],
  [2000, 4000],
  [200_000, 300_000],
  [300_000, 300_000],
])('#pickNextRetryWait doubles %p to %p and never passes 300 seconds', (waitMs, next) => {
  expect(pickNextRetryWait(waitMs)).toBe(next);
});

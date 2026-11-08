import { expect, test } from 'bun:test';
import { S2Error, SeqNumMismatchError } from '@s2-dev/streamstore';
import type { AppendOutcome } from '../fact-log.ts';
import { findAppendOutcome } from './find-append-outcome.ts';

test.each<[string, S2Error, AppendOutcome]>([
  [
    'a sequence number mismatch',
    new SeqNumMismatchError({ message: 'mismatch', status: 412, expectedSeqNum: 3 }),
    { kind: 'rejected', reason: 'tail-mismatch' },
  ],
  [
    'a stream the basin lacks',
    new S2Error({ message: 'missing', code: 'stream_not_found', status: 404, origin: 'server' }),
    { kind: 'rejected', reason: 'unknown-stream' },
  ],
  [
    'a request timeout from the server',
    new S2Error({ message: 'timeout', status: 408, origin: 'server' }),
    { kind: 'unknown' },
  ],
  [
    'a rate limit',
    new S2Error({ message: 'slow down', status: 429, origin: 'server' }),
    { kind: 'unknown' },
  ],
  [
    'a server that is unavailable',
    new S2Error({ message: 'unavailable', status: 503, origin: 'server' }),
    { kind: 'unknown' },
  ],
  [
    'a connection the client lost',
    new S2Error({ message: 'connection reset', status: 0, origin: 'sdk' }),
    { kind: 'unknown' },
  ],
])('it reports %s as its outcome', (_title, error, outcome) => {
  expect(findAppendOutcome(error)).toStrictEqual(outcome);
});

test('it returns null for a refusal the outcomes have no reason for', () => {
  const refusal = new S2Error({ message: 'bad token', status: 401, origin: 'server' });

  expect(findAppendOutcome(refusal)).toBeNull();
});

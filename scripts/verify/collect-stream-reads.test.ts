import { expect, test } from 'bun:test';
import { collectStreamReads } from './collect-stream-reads.ts';

test('it collects the start and count of each read of the stream', () => {
  const lines = [
    {
      at: '2026-10-06T08:00:01.000Z',
      line: '\u001B[2m2026-10-06T08:00:01Z\u001B[0m INFO request{method=GET uri=http://127.0.0.1:4100/v1/streams/facts.harbour.buoy/records?seq_num=41&count=20 version=HTTP/1.1}: finished',
    },
  ];

  expect(collectStreamReads(lines, 'facts.harbour.buoy')).toStrictEqual([
    { at: '2026-10-06T08:00:01.000Z', seqNum: 41, count: 20 },
  ]);
});

test.each([
  {
    kind: 'a read of another stream',
    line: 'request{method=GET uri=http://127.0.0.1:4100/v1/streams/facts.harbour.tide/records?seq_num=3&count=1}',
  },
  {
    kind: 'a tail read',
    line: 'request{method=GET uri=http://127.0.0.1:4100/v1/streams/facts.harbour.buoy/records/tail}',
  },
  {
    kind: 'an append',
    line: 'request{method=POST uri=/v1/streams/facts.harbour.buoy/records}',
  },
])('it leaves out $kind', (row) => {
  const lines = [{ at: '2026-10-06T08:00:01.000Z', line: row.line }];

  expect(collectStreamReads(lines, 'facts.harbour.buoy')).toStrictEqual([]);
});

import { expect, test } from 'bun:test';
import { applyFact } from './harbour-voyage.ts';

test('it upserts the voyage row and links it to its vessel and its port', () => {
  const operations: unknown = JSON.parse(
    applyFact(
      JSON.stringify({
        id: 'event:harbour:evt-40',
        entity: 'harbour:voyage:21',
        at: '2026-11-04T05:45:00.000Z',
        payload: { vessel: 'harbour:vessel:4', port: 'harbour:port:south', confidence: 0.75 },
      }),
    ),
  );

  expect(operations).toStrictEqual([
    {
      upsert: {
        harbour_voyage: {
          id: 'harbour:voyage:21',
          vessel_id: 'harbour:vessel:4',
          port_id: 'harbour:port:south',
          is_hailed: true,
          departed_at: '2026-11-04T05:45:00.000Z',
        },
      },
    },
    {
      link: {
        type: 'voyage_of',
        from: 'harbour:voyage:21',
        to: 'harbour:vessel:4',
        confidence: 0.75,
        evidence: 'fact event:harbour:evt-40',
      },
    },
    {
      link: {
        type: 'called_at',
        from: 'harbour:voyage:21',
        to: 'harbour:port:south',
        confidence: 1,
        evidence: 'fact event:harbour:evt-40',
      },
    },
  ]);
});

test.each([
  [
    'a fact with no confidence',
    {
      id: 'event:harbour:evt-41',
      entity: 'harbour:voyage:21',
      at: '2026-11-04T05:45:00.000Z',
      payload: { vessel: 'harbour:vessel:4', port: 'harbour:port:south' },
    },
  ],
  [
    'a fact with no port',
    {
      id: 'event:harbour:evt-41',
      entity: 'harbour:voyage:21',
      at: '2026-11-04T05:45:00.000Z',
      payload: { vessel: 'harbour:vessel:4', confidence: 1 },
    },
  ],
  [
    'a fact with no ID',
    {
      entity: 'harbour:voyage:21',
      at: '2026-11-04T05:45:00.000Z',
      payload: { vessel: 'harbour:vessel:4', port: 'harbour:port:south', confidence: 1 },
    },
  ],
])('it throws for %s', (_label, fact) => {
  const applying = () => applyFact(JSON.stringify(fact));

  expect(applying).toThrowWithMessage(Error, 'the fact is no voyage fact');
});

import { expect, test } from 'bun:test';
import type { EntityID } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import { takeHop } from './take-hop.ts';

test('it follows a link out of the frontier and a link into it, and adds both far ends', () => {
  const state = {
    depths: new Map([[toTagged<EntityID>('harbour:vessel:7'), 0]]),
    links: [],
    frontier: [toTagged<EntityID>('harbour:vessel:7')],
    isTruncated: false,
  };

  const rows = [
    {
      type: 'docked_at',
      from_id: toTagged<EntityID>('harbour:vessel:7'),
      to_id: toTagged<EntityID>('harbour:berth:3'),
      scope: null,
      origin: 'harbour_berth',
      confidence: 1,
      evidence: 'the berth log',
    },
    {
      type: 'voyage_of',
      from_id: toTagged<EntityID>('harbour:voyage:12'),
      to_id: toTagged<EntityID>('harbour:vessel:7'),
      scope: null,
      origin: 'harbour_voyage',
      confidence: 0.75,
      evidence: 'the manifest',
    },
  ];

  expect(takeHop(state, rows, { depth: 1, entityLimit: 50, linkReadLimit: 1000 })).toStrictEqual({
    depths: new Map([
      [toTagged<EntityID>('harbour:vessel:7'), 0],
      [toTagged<EntityID>('harbour:berth:3'), 1],
      [toTagged<EntityID>('harbour:voyage:12'), 1],
    ]),
    links: [
      {
        type: 'docked_at',
        from: toTagged<EntityID>('harbour:vessel:7'),
        to: toTagged<EntityID>('harbour:berth:3'),
        direction: 'outgoing',
        origin: 'harbour_berth',
        confidence: 1,
        depth: 1,
      },
      {
        type: 'voyage_of',
        from: toTagged<EntityID>('harbour:voyage:12'),
        to: toTagged<EntityID>('harbour:vessel:7'),
        direction: 'incoming',
        origin: 'harbour_voyage',
        confidence: 0.75,
        depth: 1,
      },
    ],
    frontier: [toTagged<EntityID>('harbour:berth:3'), toTagged<EntityID>('harbour:voyage:12')],
    isTruncated: false,
  });
});

test('it makes one link of a link that two origins hold, with the higher confidence', () => {
  const state = {
    depths: new Map([[toTagged<EntityID>('harbour:vessel:7'), 0]]),
    links: [],
    frontier: [toTagged<EntityID>('harbour:vessel:7')],
    isTruncated: false,
  };

  const rows = [
    {
      type: 'docked_at',
      from_id: toTagged<EntityID>('harbour:vessel:7'),
      to_id: toTagged<EntityID>('harbour:berth:3'),
      scope: null,
      origin: 'harbour_berth',
      confidence: 0.5,
      evidence: 'the berth log',
    },
    {
      type: 'docked_at',
      from_id: toTagged<EntityID>('harbour:vessel:7'),
      to_id: toTagged<EntityID>('harbour:berth:3'),
      scope: toTagged<EntityID>('harbour:berth:3'),
      origin: 'harbour_pilot',
      confidence: 0.875,
      evidence: 'the pilot report',
    },
  ];

  const next = takeHop(state, rows, { depth: 1, entityLimit: 50, linkReadLimit: 1000 });

  expect(next.links).toStrictEqual([
    {
      type: 'docked_at',
      from: toTagged<EntityID>('harbour:vessel:7'),
      to: toTagged<EntityID>('harbour:berth:3'),
      direction: 'outgoing',
      origin: 'harbour_pilot',
      confidence: 0.875,
      depth: 1,
    },
  ]);
});

test('it drops the rows past the read limit and marks the walk cut', () => {
  const state = {
    depths: new Map([[toTagged<EntityID>('harbour:vessel:7'), 0]]),
    links: [],
    frontier: [toTagged<EntityID>('harbour:vessel:7')],
    isTruncated: false,
  };

  const rows = [
    {
      type: 'docked_at',
      from_id: toTagged<EntityID>('harbour:vessel:7'),
      to_id: toTagged<EntityID>('harbour:berth:3'),
      scope: null,
      origin: 'harbour_berth',
      confidence: 1,
      evidence: 'the berth log',
    },
    {
      type: 'docked_at',
      from_id: toTagged<EntityID>('harbour:vessel:7'),
      to_id: toTagged<EntityID>('harbour:berth:4'),
      scope: null,
      origin: 'harbour_berth',
      confidence: 1,
      evidence: 'the berth log',
    },
  ];

  const next = takeHop(state, rows, { depth: 1, entityLimit: 50, linkReadLimit: 1 });

  expect({ depths: next.depths, isTruncated: next.isTruncated }).toStrictEqual({
    depths: new Map([
      [toTagged<EntityID>('harbour:vessel:7'), 0],
      [toTagged<EntityID>('harbour:berth:3'), 1],
    ]),
    isTruncated: true,
  });
});

test('it adds new IDs in ID order up to the entity limit, and drops the links to the rest', () => {
  const state = {
    depths: new Map([[toTagged<EntityID>('harbour:vessel:7'), 0]]),
    links: [],
    frontier: [toTagged<EntityID>('harbour:vessel:7')],
    isTruncated: false,
  };

  const rows = [
    {
      type: 'docked_at',
      from_id: toTagged<EntityID>('harbour:vessel:7'),
      to_id: toTagged<EntityID>('harbour:berth:9'),
      scope: null,
      origin: 'harbour_berth',
      confidence: 1,
      evidence: 'the berth log',
    },
    {
      type: 'docked_at',
      from_id: toTagged<EntityID>('harbour:vessel:7'),
      to_id: toTagged<EntityID>('harbour:berth:2'),
      scope: null,
      origin: 'harbour_berth',
      confidence: 1,
      evidence: 'the berth log',
    },
  ];

  const next = takeHop(state, rows, { depth: 1, entityLimit: 2, linkReadLimit: 1000 });

  expect({
    frontier: next.frontier,
    reached: next.links.map((link) => link.to),
    isTruncated: next.isTruncated,
  }).toStrictEqual({
    frontier: [toTagged<EntityID>('harbour:berth:2')],
    reached: [toTagged<EntityID>('harbour:berth:2')],
    isTruncated: true,
  });
});

test('it keeps a new link to an ID seen before without expanding it again, and skips a followed link', () => {
  const state = {
    depths: new Map([
      [toTagged<EntityID>('harbour:vessel:7'), 0],
      [toTagged<EntityID>('harbour:voyage:12'), 1],
      [toTagged<EntityID>('harbour:voyage:13'), 1],
    ]),
    links: [
      {
        type: 'voyage_of',
        from: toTagged<EntityID>('harbour:voyage:12'),
        to: toTagged<EntityID>('harbour:vessel:7'),
        direction: 'incoming',
        origin: 'harbour_voyage',
        confidence: 1,
        depth: 1,
      } as const,
    ],
    frontier: [toTagged<EntityID>('harbour:voyage:12'), toTagged<EntityID>('harbour:voyage:13')],
    isTruncated: false,
  };

  const rows = [
    {
      type: 'followed_by',
      from_id: toTagged<EntityID>('harbour:voyage:12'),
      to_id: toTagged<EntityID>('harbour:voyage:13'),
      scope: null,
      origin: 'harbour_voyage',
      confidence: 1,
      evidence: 'the schedule',
    },
    {
      type: 'voyage_of',
      from_id: toTagged<EntityID>('harbour:voyage:12'),
      to_id: toTagged<EntityID>('harbour:vessel:7'),
      scope: null,
      origin: 'harbour_voyage',
      confidence: 1,
      evidence: 'the manifest',
    },
  ];

  const next = takeHop(state, rows, { depth: 2, entityLimit: 50, linkReadLimit: 1000 });

  expect(next).toStrictEqual({
    depths: state.depths,
    links: [
      ...state.links,
      {
        type: 'followed_by',
        from: toTagged<EntityID>('harbour:voyage:12'),
        to: toTagged<EntityID>('harbour:voyage:13'),
        direction: 'outgoing',
        origin: 'harbour_voyage',
        confidence: 1,
        depth: 2,
      },
    ],
    frontier: [],
    isTruncated: false,
  });
});

import { expect, test } from 'bun:test';
import { buildLinkRegistry, defineLinkType } from '@pepys/kit';
import { pickLinkTypes } from './pick-link-types.ts';

test.each([
  {
    title: 'every type but the hubs for no names',
    linkTypes: null,
    includeHubs: false,
    picked: ['docked_at', 'voyage_of'],
  },
  {
    title: 'every type for no names with hubs',
    linkTypes: null,
    includeHubs: true,
    picked: ['crewed_by', 'docked_at', 'voyage_of'],
  },
  {
    title: 'the named types once each, in name order',
    linkTypes: ['voyage_of', 'docked_at', 'voyage_of'],
    includeHubs: false,
    picked: ['docked_at', 'voyage_of'],
  },
  {
    title: 'no named hub type without hubs',
    linkTypes: ['crewed_by', 'docked_at'],
    includeHubs: false,
    picked: ['docked_at'],
  },
  {
    title: 'a named hub type with hubs',
    linkTypes: ['crewed_by'],
    includeHubs: true,
    picked: ['crewed_by'],
  },
  { title: 'nothing for an empty list', linkTypes: [], includeHubs: true, picked: [] },
])('it picks $title', (row) => {
  const registry = buildLinkRegistry([
    defineLinkType({
      name: 'voyage_of',
      from: ['harbour:voyage'],
      to: ['harbour:vessel'],
      hub: false,
    }),
    defineLinkType({
      name: 'docked_at',
      from: ['harbour:vessel'],
      to: ['harbour:berth'],
      hub: false,
    }),
    defineLinkType({
      name: 'crewed_by',
      from: ['harbour:vessel'],
      to: ['harbour:sailor'],
      hub: true,
    }),
  ]);

  const picked = pickLinkTypes(registry, {
    linkTypes: row.linkTypes,
    includeHubs: row.includeHubs,
  });

  expect(picked).toStrictEqual({ ok: true, value: row.picked });
});

test('it names each unknown type once, with every known type', () => {
  const registry = buildLinkRegistry([
    defineLinkType({
      name: 'voyage_of',
      from: ['harbour:voyage'],
      to: ['harbour:vessel'],
      hub: false,
    }),
    defineLinkType({
      name: 'docked_at',
      from: ['harbour:vessel'],
      to: ['harbour:berth'],
      hub: false,
    }),
  ]);

  const picked = pickLinkTypes(registry, {
    linkTypes: ['towed_by', 'voyage_of', 'anchored_in', 'towed_by'],
    includeHubs: false,
  });

  expect(picked).toStrictEqual({
    ok: false,
    failure: { unknown: ['anchored_in', 'towed_by'], known: ['docked_at', 'voyage_of'] },
  });
});

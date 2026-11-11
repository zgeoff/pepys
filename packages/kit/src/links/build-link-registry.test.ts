import { expect, test } from 'bun:test';
import { defineLinkType } from '../link-types/define-link-type.ts';
import type { LinkTypeDeclaration } from '../link-types/types.ts';
import { buildLinkRegistry } from './build-link-registry.ts';

test('it maps each link type to its declaration by name', () => {
  const dockedAt = defineLinkType({
    name: 'docked_at',
    from: ['harbour:vessel'],
    to: ['harbour:berth'],
    hub: false,
  });

  const crewedBy = defineLinkType({
    name: 'crewed_by',
    from: ['harbour:vessel'],
    to: ['harbour:sailor'],
    hub: true,
  });

  expect(buildLinkRegistry([dockedAt, crewedBy])).toStrictEqual(
    new Map<string, LinkTypeDeclaration>([
      ['docked_at', dockedAt],
      ['crewed_by', crewedBy],
    ]),
  );
});

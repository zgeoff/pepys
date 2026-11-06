import { expect, test } from 'bun:test';
import { toTagged } from '@zgeoff/std';
import type { EntityID } from '../ids/ids.ts';
import { isEntityOfKind } from './is-entity-of-kind.ts';

test.each([
  { id: 'github:issue:412', kinds: ['github:issue'], expected: true },
  { id: 'github:issue:412', kinds: ['gmail:msg', 'github:issue'], expected: true },
  { id: 'github:pr:412', kinds: ['github:issue'], expected: false },
  { id: 'gmail:issue:412', kinds: ['github:issue'], expected: false },
  { id: 'harbour', kinds: ['github:issue'], expected: false },
] as const)('it answers $expected for $id among $kinds', (row) => {
  expect(isEntityOfKind(toTagged<EntityID>(row.id), row.kinds)).toBe(row.expected);
});

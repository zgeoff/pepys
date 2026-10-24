import { expect, test } from 'bun:test';
import { buildEntityID } from './build-entity-id.ts';

test('it builds an entity ID from its three parts', () => {
  expect<unknown>(buildEntityID({ source: 'github', kind: 'pr', id: '1874433021' })).toStrictEqual({
    ok: true,
    value: 'github:pr:1874433021',
  });
});

test('it keeps the colons of the last part', () => {
  expect<unknown>(buildEntityID({ source: 'gmail', kind: 'msg', id: 'a:b:c' })).toStrictEqual({
    ok: true,
    value: 'gmail:msg:a:b:c',
  });
});

test.each([
  ['an uppercase source', { source: 'GitHub', kind: 'pr', id: '1' }, 'invalid-source'],
  ['a source that starts with a digit', { source: '1git', kind: 'pr', id: '1' }, 'invalid-source'],
  ['a source with a colon', { source: 'git:hub', kind: 'pr', id: '1' }, 'invalid-source'],
  ['an empty source', { source: '', kind: 'pr', id: '1' }, 'invalid-source'],
  ['a fact kind as the source', { source: 'webhook', kind: 'github', id: '1' }, 'reserved-source'],
  ['a kind with a dash', { source: 'github', kind: 'pull-request', id: '1' }, 'invalid-kind'],
  ['an empty kind', { source: 'github', kind: '', id: '1' }, 'invalid-kind'],
  ['an empty ID', { source: 'github', kind: 'pr', id: '' }, 'empty-id'],
])('it refuses %s', (_label, parts, reason) => {
  expect<unknown>(buildEntityID(parts)).toStrictEqual({ ok: false, failure: { reason } });
});

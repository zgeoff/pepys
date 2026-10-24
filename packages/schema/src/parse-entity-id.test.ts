import { expect, test } from 'bun:test';
import invariant from 'tiny-invariant';
import { buildEntityID } from './build-entity-id.ts';
import { parseEntityID } from './parse-entity-id.ts';

test('it parses an entity ID into its three parts', () => {
  expect<unknown>(parseEntityID('github:user:583231')).toStrictEqual({
    ok: true,
    value: { source: 'github', kind: 'user', id: '583231' },
  });
});

test('it reads everything after the second colon as the ID', () => {
  expect<unknown>(parseEntityID('gmail:msg:a:b:c')).toStrictEqual({
    ok: true,
    value: { source: 'gmail', kind: 'msg', id: 'a:b:c' },
  });
});

test('it parses the ID that buildEntityID builds', () => {
  const built = buildEntityID({ source: 'gmail', kind: 'msg', id: '18c4f2a9b01e' });

  invariant(built.ok);

  expect<unknown>(parseEntityID(built.value)).toStrictEqual({
    ok: true,
    value: { source: 'gmail', kind: 'msg', id: '18c4f2a9b01e' },
  });
});

test.each([
  ['text with no colon', 'github', 'malformed'],
  ['text with one colon', 'github:pr', 'malformed'],
  ['an uppercase source', 'GitHub:pr:1', 'invalid-source'],
  ['a fact kind as the source', 'manual:github:1', 'reserved-source'],
  ['a kind with a dash', 'github:pull-request:1', 'invalid-kind'],
  ['an empty ID', 'github:pr:', 'empty-id'],
])('it refuses %s', (_label, text, reason) => {
  expect<unknown>(parseEntityID(text)).toStrictEqual({ ok: false, failure: { reason } });
});

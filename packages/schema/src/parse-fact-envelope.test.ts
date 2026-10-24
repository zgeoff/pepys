import { expect, test } from 'bun:test';
import invariant from 'tiny-invariant';
import { parseFactEnvelope } from './parse-fact-envelope.ts';

test('it accepts an envelope with every field', () => {
  const envelope = {
    id: 'webhook:github:d-4f1c',
    type: 'github.pull_request.opened',
    v: 1,
    api: 'github/2022-11-28',
    entity: 'github:pr:1874433021',
    actor: 'github:user:583231',
    at: '2026-10-24T01:02:03Z',
    cursor: 'page-7',
    payload: { number: 412, title: 'add the schema package' },
  };

  expect<unknown>(parseFactEnvelope(envelope)).toStrictEqual({ ok: true, value: envelope });
});

test('it accepts an envelope with no actor and no cursor', () => {
  const envelope = {
    id: 'observation:0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0',
    type: 'gmail.label.observed',
    v: 1,
    api: 'gmail/v1',
    entity: 'gmail:label:inbox',
    at: '2026-10-24T01:02:03.456Z',
    payload: null,
  };

  expect<unknown>(parseFactEnvelope(envelope)).toStrictEqual({ ok: true, value: envelope });
});

test('it leaves the payload untouched', () => {
  const result = parseFactEnvelope({
    id: 'manual:01939c9a-7b2e-7c3a-8d4f-5a6b7c8d9e0f',
    type: 'manual.link.asserted',
    v: 1,
    api: 'pepys/1',
    entity: 'github:pr:1',
    at: '2026-10-24T01:02:03Z',
    payload: { extra: ['kept', 1, null], nested: { flag: true } },
  });

  invariant(result.ok);

  expect(result.value.payload).toStrictEqual({ extra: ['kept', 1, null], nested: { flag: true } });
});

test('it rejects an unknown envelope key', () => {
  const result = parseFactEnvelope({
    id: 'webhook:github:d-4f1c',
    type: 'github.pull_request.opened',
    v: 1,
    api: 'github/2022-11-28',
    entity: 'github:pr:1874433021',
    at: '2026-10-24T01:02:03Z',
    payload: {},
    extra: true,
  });

  invariant(!result.ok);

  expect(result.failure.issues).toPartiallyContain({ code: 'unrecognized_keys', keys: ['extra'] });
});

test('it rejects a fact ID of no known kind', () => {
  const result = parseFactEnvelope({
    id: 'github:pr:1874433021',
    type: 'github.pull_request.opened',
    v: 1,
    api: 'github/2022-11-28',
    entity: 'github:pr:1874433021',
    at: '2026-10-24T01:02:03Z',
    payload: {},
  });

  invariant(!result.ok);

  expect(result.failure.issues).toPartiallyContain({ path: ['id'] });
});

test('it rejects an entity that is not an entity ID', () => {
  const result = parseFactEnvelope({
    id: 'webhook:github:d-4f1c',
    type: 'github.pull_request.opened',
    v: 1,
    api: 'github/2022-11-28',
    entity: 'acme/api#412',
    at: '2026-10-24T01:02:03Z',
    payload: {},
  });

  invariant(!result.ok);

  expect(result.failure.issues).toPartiallyContain({ path: ['entity'] });
});

test('it rejects an actor that is not an entity ID', () => {
  const result = parseFactEnvelope({
    id: 'webhook:github:d-4f1c',
    type: 'github.pull_request.opened',
    v: 1,
    api: 'github/2022-11-28',
    entity: 'github:pr:1874433021',
    actor: 'octocat',
    at: '2026-10-24T01:02:03Z',
    payload: {},
  });

  invariant(!result.ok);

  expect(result.failure.issues).toPartiallyContain({ path: ['actor'] });
});

test('it rejects an envelope version other than 1', () => {
  const result = parseFactEnvelope({
    id: 'webhook:github:d-4f1c',
    type: 'github.pull_request.opened',
    v: 2,
    api: 'github/2022-11-28',
    entity: 'github:pr:1874433021',
    at: '2026-10-24T01:02:03Z',
    payload: {},
  });

  invariant(!result.ok);

  expect(result.failure.issues).toPartiallyContain({ path: ['v'] });
});

test('it rejects a time that is not ISO 8601 UTC', () => {
  const result = parseFactEnvelope({
    id: 'webhook:github:d-4f1c',
    type: 'github.pull_request.opened',
    v: 1,
    api: 'github/2022-11-28',
    entity: 'github:pr:1874433021',
    at: '2026-10-24T11:02:03+10:00',
    payload: {},
  });

  invariant(!result.ok);

  expect(result.failure.issues).toPartiallyContain({ path: ['at'] });
});

test('it rejects an envelope with no payload', () => {
  const result = parseFactEnvelope({
    id: 'webhook:github:d-4f1c',
    type: 'github.pull_request.opened',
    v: 1,
    api: 'github/2022-11-28',
    entity: 'github:pr:1874433021',
    at: '2026-10-24T01:02:03Z',
  });

  invariant(!result.ok);

  expect(result.failure.issues).toPartiallyContain({ path: ['payload'] });
});

test('it rejects a value that is not an object', () => {
  expect(parseFactEnvelope('webhook:github:d-4f1c').ok).toBe(false);
});

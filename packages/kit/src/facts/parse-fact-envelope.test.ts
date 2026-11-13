import { expect, test } from 'bun:test';
import { toTagged } from '@zgeoff/std';
import invariant from 'tiny-invariant';
import envelopeCases from '../fact-envelope-cases.json' with { type: 'json' };
import type { ClientID, RequestID } from '../ids/types.ts';
import { buildManualFactID } from './build-manual-fact-id.ts';
import { parseFactEnvelope } from './parse-fact-envelope.ts';

// The host's envelope check runs the same cases, so the two checks cannot drift apart unseen. Only
// this test checks the issue path of a refused case: the host's check names no field.
test.each(
  envelopeCases.cases
    .filter((envelopeCase) => envelopeCase.isValid)
    .map((envelopeCase) => [envelopeCase.title, envelopeCase] as const),
)('it %s, in the shared envelope cases', (_title, envelopeCase) => {
  const actual: unknown = parseFactEnvelope(envelopeCase.envelope);

  expect(actual).toStrictEqual({ ok: true, value: envelopeCase.envelope });
});

test.each(
  envelopeCases.cases
    .filter((envelopeCase) => !envelopeCase.isValid)
    .map((envelopeCase) => [envelopeCase.title, envelopeCase] as const),
)('it %s, at its issue path, in the shared envelope cases', (_title, envelopeCase) => {
  const result = parseFactEnvelope(envelopeCase.envelope);

  invariant(!result.ok);
  invariant(envelopeCase.issuePath !== undefined);

  expect(result.failure.issues.map((issue) => issue.path)).toStrictEqual([envelopeCase.issuePath]);
});

test('it accepts an envelope with every field', () => {
  const envelope = {
    id: 'webhook:github:d-4f1c',
    type: 'github.pull_request.opened',
    v: 1,
    api: 'github/2022-11-28',
    entity: 'github:pull_request:1874433021',
    actor: 'github:user:583231',
    at: '2026-10-24T01:02:03Z',
    cursor: 'page-7',
    payload: { number: 412, title: 'add the schema package' },
  };

  const actual: unknown = parseFactEnvelope(envelope);

  expect(actual).toStrictEqual({ ok: true, value: envelope });
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

  const actual: unknown = parseFactEnvelope(envelope);

  expect(actual).toStrictEqual({ ok: true, value: envelope });
});

test('it leaves the payload untouched', () => {
  const result = parseFactEnvelope({
    id: 'manual:9c2d4e6f8a0b1c3d5e7f9a1b3c5d7e9f0a2b4c6d8e0f1a3b5c7d9e1f3a5b7c9d',
    type: 'manual.link.asserted',
    v: 1,
    api: 'pepys/1',
    entity: 'github:pull_request:1',
    at: '2026-10-24T01:02:03Z',
    payload: { extra: ['kept', 1, null], nested: { flag: true } },
  });

  invariant(result.ok);

  expect(result.value.payload).toStrictEqual({ extra: ['kept', 1, null], nested: { flag: true } });
});

test('it accepts the ID that buildManualFactID gives', () => {
  const id = buildManualFactID(
    toTagged<ClientID>('client-ledger'),
    toTagged<RequestID>('request-1'),
  );

  const actual: unknown = parseFactEnvelope({
    id,
    type: 'manual.link.asserted',
    v: 1,
    api: 'pepys/1',
    entity: 'github:pull_request:1',
    at: '2026-10-24T01:02:03Z',
    payload: {},
  });

  expect(actual).toStrictEqual({
    ok: true,
    value: {
      id,
      type: 'manual.link.asserted',
      v: 1,
      api: 'pepys/1',
      entity: 'github:pull_request:1',
      at: '2026-10-24T01:02:03Z',
      payload: {},
    },
  });
});

test('it rejects an unknown envelope key', () => {
  const result = parseFactEnvelope({
    id: 'webhook:github:d-4f1c',
    type: 'github.pull_request.opened',
    v: 1,
    api: 'github/2022-11-28',
    entity: 'github:pull_request:1874433021',
    at: '2026-10-24T01:02:03Z',
    payload: {},
    extra: true,
  });

  invariant(!result.ok);

  expect(result.failure.issues).toPartiallyContain({
    code: 'unrecognized_keys',
    keys: ['extra'],
    path: [],
  });
});

test('it rejects a fact ID of no known kind', () => {
  const result = parseFactEnvelope({
    id: 'github:pull_request:1874433021',
    type: 'github.pull_request.opened',
    v: 1,
    api: 'github/2022-11-28',
    entity: 'github:pull_request:1874433021',
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
    entity: 'github:pull_request:1874433021',
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
    entity: 'github:pull_request:1874433021',
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
    entity: 'github:pull_request:1874433021',
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
    entity: 'github:pull_request:1874433021',
    at: '2026-10-24T01:02:03Z',
  });

  invariant(!result.ok);

  expect(result.failure.issues).toPartiallyContain({ path: ['payload'] });
});

test('it rejects a value that is not an object', () => {
  const result = parseFactEnvelope('webhook:github:d-4f1c');

  invariant(!result.ok);

  expect(result.failure.issues).toPartiallyContain({ code: 'invalid_type', path: [] });
});

import type { ConsumerDeclaration, Result } from '@pepys/kit';
import type { ApplyFailure, Row, WireLink } from '../utils/types.ts';
import type { Operation } from './types.ts';

// The wire of a module's output: one JSON list, each item an object with exactly one verb.
export function parseOperations(
  consumer: ConsumerDeclaration,
  output: string,
): Result<Operation[], ApplyFailure> {
  const bad = (reason: string): Result<Operation[], ApplyFailure> => ({
    ok: false,
    failure: { kind: 'bad-operation', consumer: consumer.name, reason },
  });

  const parsed = parseOutput(output);

  if (!parsed.ok) {
    return bad('the output is not JSON');
  }

  if (!Array.isArray(parsed.value)) {
    return bad('the output is not a list');
  }

  const operations: Operation[] = [];

  for (const item of parsed.value) {
    const operation = parseOperation(consumer, item);

    if (!operation.ok) {
      return operation;
    }

    operations.push(operation.value);
  }

  return { ok: true, value: operations };
}

function parseOutput(output: string): Result<unknown, undefined> {
  try {
    const value: unknown = JSON.parse(output, reviveNumber);

    return { ok: true, value };
  } catch {
    return { ok: false, failure: undefined };
  }
}

interface ReviverContext {
  source?: string;
}

// JSON.parse loses the text of a number, so `1.0` reads as `1`. The reviver's source text keeps
// it: each object records the keys whose number had a fraction or an exponent.
const inexactKeys = new WeakMap<object, Set<string>>();

function reviveNumber(
  this: unknown,
  key: string,
  value: unknown,
  context?: ReviverContext,
): unknown {
  if (typeof value === 'number' && isObject(this) && /[.eE]/u.test(context?.source ?? '')) {
    inexactKeys.set(this, new Set([...(inexactKeys.get(this) ?? []), key]));
  }

  return value;
}

function isObject(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseOperation(
  consumer: ConsumerDeclaration,
  item: unknown,
): Result<Operation, ApplyFailure> {
  const bad = (reason: string): Result<Operation, ApplyFailure> => ({
    ok: false,
    failure: { kind: 'bad-operation', consumer: consumer.name, reason },
  });

  if (!isObject(item)) {
    return bad('an operation is not an object');
  }

  const entries = Object.entries(item);
  const [verb, body] = entries[0] ?? [];

  if (entries.length !== 1) {
    return bad('an operation does not hold exactly one verb');
  }

  if (verb === 'link') {
    const link = parseLink(body);

    return link === undefined
      ? bad('a link is not a type, two ends, a confidence and an evidence')
      : { ok: true, value: { verb: 'link', link } };
  }

  if (verb === 'unlink') {
    const link = parseLinkKey(body);

    return link === undefined
      ? bad('an unlink is not a type and two ends')
      : { ok: true, value: { verb: 'unlink', link } };
  }

  if (verb !== 'upsert' && verb !== 'delete') {
    return bad(`the verb ${String(verb)} is unknown`);
  }

  const tables = isObject(body) ? Object.entries(body) : [];
  const [table, row] = tables[0] ?? [];

  if (tables.length !== 1 || table === undefined || !isObject(row)) {
    return bad(`an ${verb} does not hold exactly one table and one row`);
  }

  if (!Object.hasOwn(consumer.tables, table)) {
    return { ok: false, failure: { kind: 'not-owned', consumer: consumer.name, table } };
  }

  const columns = inexactKeys.get(row) ?? new Set<string>();

  return {
    ok: true,
    value:
      verb === 'upsert'
        ? { verb, table, row, inexact: columns }
        : { verb, table, key: row, inexact: columns },
  };
}

function parseLink(body: unknown): WireLink | undefined {
  const key = parseLinkKey(body);

  if (key === undefined || !isObject(body)) {
    return undefined;
  }

  const confidence = body['confidence'];
  const evidence = body['evidence'];

  if (typeof confidence !== 'number' || typeof evidence !== 'string') {
    return undefined;
  }

  return { ...key, confidence, evidence };
}

function parseLinkKey(body: unknown): Pick<WireLink, 'type' | 'from' | 'to'> | undefined {
  if (!isObject(body)) {
    return undefined;
  }

  const type = body['type'];
  const from = body['from'];
  const to = body['to'];

  if (typeof type !== 'string' || typeof from !== 'string' || typeof to !== 'string') {
    return undefined;
  }

  return { type, from, to };
}

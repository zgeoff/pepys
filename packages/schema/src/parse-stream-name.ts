import type { Result } from './types.ts';

const partPattern = /^[a-z][a-z0-9_]*$/u;

interface StreamNameParts {
  source: string;
  family: string;
}

type StreamNameFailure =
  | { reason: 'malformed' }
  | { reason: 'invalid-source' }
  | { reason: 'invalid-family' };

export function parseStreamName(text: string): Result<StreamNameParts, StreamNameFailure> {
  const parts = text.split('.');

  if (parts.length !== 3 || parts[0] !== 'facts') {
    return { ok: false, failure: { reason: 'malformed' } };
  }

  const [, source = '', family = ''] = parts;

  if (!partPattern.test(source)) {
    return { ok: false, failure: { reason: 'invalid-source' } };
  }

  if (!partPattern.test(family)) {
    return { ok: false, failure: { reason: 'invalid-family' } };
  }

  return { ok: true, value: { source, family } };
}

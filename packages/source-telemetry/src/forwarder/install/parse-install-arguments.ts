import { parseArgs } from 'node:util';
import type { Result } from '@pepys/kit';

export interface InstallArguments {
  issuer: string;
  audience: string;
  ingestURL: string | null;
}

const issuerPattern = /^[A-Za-z0-9._-]{1,128}$/u;

// eslint-disable-next-line no-control-regex -- a control character would break the unit file
const controlCharacter = /[\u0000-\u001F\u007F]/u;

export function hasControlCharacter(text: string): boolean {
  return controlCharacter.test(text);
}

export function parseInstallArguments(argv: readonly string[]): Result<InstallArguments, string> {
  let values: {
    issuer?: string | undefined;
    audience?: string | undefined;
    'ingest-url'?: string | undefined;
  };

  try {
    values = parseArgs({
      args: [...argv],
      options: {
        issuer: { type: 'string' },
        audience: { type: 'string' },
        'ingest-url': { type: 'string' },
      },
      strict: true,
      allowPositionals: false,
    }).values;
  } catch (error) {
    return { ok: false, failure: error instanceof Error ? error.message : 'bad arguments' };
  }

  const issuer = values.issuer;
  const audience = values.audience;

  if (issuer === undefined || audience === undefined) {
    return { ok: false, failure: 'install needs --issuer and --audience' };
  }

  if (!issuerPattern.test(issuer)) {
    return {
      ok: false,
      failure: 'the issuer must be 1 to 128 letters, digits, ".", "_" or "-"',
    };
  }

  if (audience === '' || hasControlCharacter(audience)) {
    return { ok: false, failure: 'the audience must be text with no control character' };
  }

  const ingestURL = values['ingest-url'];

  if (ingestURL === undefined) {
    return { ok: true, value: { issuer, audience, ingestURL: null } };
  }

  if (!isHTTPSOrigin(ingestURL)) {
    return { ok: false, failure: 'the ingest URL must be https:// with a host and no path' };
  }

  return { ok: true, value: { issuer, audience, ingestURL: ingestURL.replace(/\/$/u, '') } };
}

function isHTTPSOrigin(text: string): boolean {
  if (!URL.canParse(text) || hasControlCharacter(text)) {
    return false;
  }

  const url = new URL(text);

  return (
    url.protocol === 'https:' &&
    url.host !== '' &&
    url.pathname === '/' &&
    url.search === '' &&
    url.hash === '' &&
    url.username === '' &&
    url.password === ''
  );
}

import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Result } from '@pepys/kit';

export interface ForwarderSettings {
  host: string;
  port: number;
  spoolDir: string;
  identityDir: string;

  // the send loop's settings; null when no ingest URL is set, and the forwarder only receives
  send: { ingestURL: string; issuer: string; audience: string } | null;
}

type Environment = Readonly<Record<string, string | undefined>>;

// The settings of `run`, from the environment. Unset and empty variables read the same.
export function resolveSettings(
  environment: Environment,
  home: string,
): Result<ForwarderSettings, string> {
  const findVariable = (name: string): string | null => {
    const value = environment[name];

    return value === undefined || value === '' ? null : value;
  };

  const port = parsePort(findVariable('PEPYS_FORWARDER_PORT') ?? '4318');

  if (port === null) {
    return { ok: false, failure: 'PEPYS_FORWARDER_PORT must be a port number from 0 to 65535' };
  }

  const base = {
    host: findVariable('PEPYS_FORWARDER_HOST') ?? '127.0.0.1',
    port,
    spoolDir:
      findVariable('PEPYS_FORWARDER_SPOOL_DIR') ??
      join(home, '.local/state/pepys-telemetry-forwarder'),
    identityDir:
      findVariable('PEPYS_FORWARDER_IDENTITY_DIR') ??
      join(home, '.config/pepys-telemetry-forwarder'),
  };

  const ingestURL = findVariable('PEPYS_FORWARDER_INGEST_URL');

  if (ingestURL === null) {
    return { ok: true, value: { ...base, send: null } };
  }

  const issuer = findVariable('PEPYS_FORWARDER_ISSUER');
  const audience = findVariable('PEPYS_FORWARDER_AUDIENCE');

  if (issuer === null || audience === null) {
    return {
      ok: false,
      failure:
        'PEPYS_FORWARDER_ISSUER and PEPYS_FORWARDER_AUDIENCE must be set when PEPYS_FORWARDER_INGEST_URL is set',
    };
  }

  if (!URL.canParse(ingestURL)) {
    return { ok: false, failure: 'PEPYS_FORWARDER_INGEST_URL is not a URL' };
  }

  return {
    ok: true,
    value: { ...base, send: { ingestURL: ingestURL.replace(/\/+$/u, ''), issuer, audience } },
  };
}

export function readSettings(environment: Environment): Result<ForwarderSettings, string> {
  return resolveSettings(environment, homedir());
}

function parsePort(text: string): number | null {
  const port = Number(text);

  return /^\d+$/u.test(text) && port <= 65_535 ? port : null;
}

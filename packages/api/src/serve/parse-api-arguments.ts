import { parseArgs } from 'node:util';
import type { Result } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import type { ClientsAction } from '../oauth/admin/run-clients.ts';
import type { PasskeysAction } from '../oauth/admin/run-passkeys.ts';
import type { OAuthClientID, OAuthGrantID, PasskeyID } from '../oauth/auth/types.ts';

// What one run of the API's entry does: serve, or one admin command on the
// OAuth server's database.
export type APICommand =
  | { readonly kind: 'serve' }
  | { readonly kind: 'passkeys'; readonly action: PasskeysAction }
  | { readonly kind: 'clients'; readonly action: ClientsAction }
  | { readonly kind: 'grants'; readonly revoke: OAuthGrantID | null };

const usage = [
  'usage: <entry>                                   serve the API',
  '       <entry> passkeys [list]                   list the enrolled passkeys',
  '       <entry> passkeys enroll [--reset]         print a one-time token that enrolls a passkey',
  '       <entry> passkeys remove <id>              remove a passkey',
  '       <entry> clients [list]                    list the clients',
  '       <entry> clients add <name> --redirect-uri <uri> [--redirect-uri <uri>...]',
  '       <entry> clients remove <id>               remove a client and revoke its grants',
  '       <entry> grants [--revoke=<grant_id>]      list the grants, or revoke one',
].join('\n');

export function parseAPIArguments(args: readonly string[]): Result<APICommand, string> {
  const [command, ...rest] = args;

  try {
    if (command === undefined) {
      return { ok: true, value: { kind: 'serve' } };
    }

    if (command === 'passkeys') {
      return parsePasskeys(rest);
    }

    if (command === 'clients') {
      return parseClients(rest);
    }

    if (command === 'grants') {
      const parsed = parseArgs({
        args: rest,
        options: { revoke: { type: 'string' } },
      });

      const revoke = parsed.values.revoke;

      return {
        ok: true,
        value: {
          kind: 'grants',
          revoke: revoke === undefined ? null : toTagged<OAuthGrantID>(revoke),
        },
      };
    }

    return { ok: false, failure: usage };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    return { ok: false, failure: `${reason}\n${usage}` };
  }
}

function parsePasskeys(args: readonly string[]): Result<APICommand, string> {
  const parsed = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: { reset: { type: 'boolean' } },
  });

  const [action, ...positionals] = parsed.positionals;
  const isReset = parsed.values.reset === true;

  if ((action === undefined || action === 'list') && positionals.length === 0 && !isReset) {
    return { ok: true, value: { kind: 'passkeys', action: { kind: 'list' } } };
  }

  if (action === 'enroll' && positionals.length === 0) {
    return { ok: true, value: { kind: 'passkeys', action: { kind: 'enroll', reset: isReset } } };
  }

  const [id, ...extra] = positionals;

  if (action === 'remove' && id !== undefined && extra.length === 0 && !isReset) {
    return {
      ok: true,
      value: { kind: 'passkeys', action: { kind: 'remove', id: toTagged<PasskeyID>(id) } },
    };
  }

  return { ok: false, failure: usage };
}

function parseClients(args: readonly string[]): Result<APICommand, string> {
  const parsed = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: { 'redirect-uri': { type: 'string', multiple: true } },
  });

  const [action, ...positionals] = parsed.positionals;
  const redirectURIs = parsed.values['redirect-uri'] ?? [];
  const [operand, ...extra] = positionals;

  if ((action === undefined || action === 'list') && positionals.length === 0) {
    return redirectURIs.length === 0
      ? { ok: true, value: { kind: 'clients', action: { kind: 'list' } } }
      : { ok: false, failure: usage };
  }

  if (action === 'add' && operand !== undefined && extra.length === 0) {
    return {
      ok: true,
      value: { kind: 'clients', action: { kind: 'add', name: operand, redirectURIs } },
    };
  }

  if (action === 'remove' && operand !== undefined && extra.length === 0) {
    return redirectURIs.length === 0
      ? {
          ok: true,
          value: {
            kind: 'clients',
            action: { kind: 'remove', clientID: toTagged<OAuthClientID>(operand) },
          },
        }
      : { ok: false, failure: usage };
  }

  return { ok: false, failure: usage };
}

import type { GrantID, OAuthClientID } from '@zgeoff/mcp-auth';
import invariant from 'tiny-invariant';
import { z } from 'zod';

// One access or refresh token as pepys wrote it before each grant had its own
// user row: every token of a grant carries the grant's authorization code ID.
export interface StoredToken {
  readonly grantID: GrantID;
  readonly clientID: OAuthClientID;

  // A JSON array, such as ["read","offline_access"].
  readonly scopes: string;
  readonly createdAt: string;

  // Neither expired nor revoked.
  readonly isLive: boolean;
}

interface GrantRowSource {
  readonly tokens: readonly StoredToken[];

  // Grants revoked before the migration. A refresh that lost the race with
  // the revoke may have left a token of one.
  readonly revoked: ReadonlySet<GrantID>;
  readonly clientNames: ReadonlyMap<OAuthClientID, string | null>;

  // When each grant last reached /mcp.
  readonly lastUsedAt: ReadonlyMap<GrantID, string>;

  // The scopes a grant may hold.
  readonly scopes: readonly string[];

  // The migration's time, as an ISO 8601 string.
  readonly at: string;
}

// The columns of the auth core's grant row.
export interface GrantRow {
  readonly id: GrantID;
  readonly name: string;
  readonly email: string;
  readonly emailVerified: 1;
  readonly image: null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly clientId: OAuthClientID;
  readonly scopes: string;
  readonly approvedBy: 'passkey';
  readonly limits: null;
  readonly lastUsedAt: string | null;
}

// One row per grant with a live token: its client's name, the scopes its live
// tokens hold, and the time of its first token.
export function collectGrantRows(source: GrantRowSource): GrantRow[] {
  const liveIDs = new Set(
    source.tokens
      .filter((token) => token.isLive && !source.revoked.has(token.grantID))
      .map((token) => token.grantID),
  );

  return [...liveIDs].map((grantID) => {
    const tokens = source.tokens.filter((token) => token.grantID === grantID);
    const live = tokens.filter((token) => token.isLive);
    const [first] = tokens.toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));

    const held = new Set(live.flatMap((token) => parseScopes(token.scopes)));

    const clientID = live[0]?.clientID ?? tokens[0]?.clientID;

    invariant(first !== undefined && clientID !== undefined, 'a live grant has a token');

    return {
      id: grantID,
      name: source.clientNames.get(clientID) ?? clientID,
      email: `${grantID}@grant.invalid`,
      emailVerified: 1,
      image: null,
      createdAt: first.createdAt,
      updatedAt: source.at,
      clientId: clientID,
      scopes: JSON.stringify(source.scopes.filter((scope) => held.has(scope))),
      approvedBy: 'passkey',
      limits: null,
      lastUsedAt: source.lastUsedAt.get(grantID) ?? null,
    };
  });
}

const ScopesSchema = z.array(z.string());

function parseScopes(text: string): string[] {
  const parsed: unknown = JSON.parse(text);

  return ScopesSchema.safeParse(parsed).data ?? [];
}

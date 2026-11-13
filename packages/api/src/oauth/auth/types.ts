import type { Tagged } from 'type-fest';
import type { GrantScope } from '../constants.ts';
import type { ApprovalState } from './create-approval-state.ts';
import type { EnrollmentState } from './create-enrollment-state.ts';
import type { openMCPAuth } from './open-mcp-auth.ts';
import type { Clock } from './system-clock.ts';

// The client ID an OAuth client registered with, not the row id of its record.
export type OAuthClientID = Tagged<string, 'OAuthClientID'>;

// The row id of an OAuth client's record.
export type OAuthClientRecordID = Tagged<string, 'OAuthClientRecordID'>;

export type OAuthAccessTokenID = Tagged<string, 'OAuthAccessTokenID'>;

export type OAuthRefreshTokenID = Tagged<string, 'OAuthRefreshTokenID'>;

export type OAuthConsentID = Tagged<string, 'OAuthConsentID'>;

// A grant is one authorization code and every token issued from it.
export type OAuthGrantID = Tagged<string, 'OAuthGrantID'>;

export type OwnerSessionID = Tagged<string, 'OwnerSessionID'>;

export type PasskeyID = Tagged<string, 'PasskeyID'>;

// Matches up the security events of one authorization.
export type CorrelationID = Tagged<string, 'CorrelationID'>;

export interface Requester {
  readonly socketAddress: string | null;

  // the `CF-Connecting-IP` header. Anyone can send it, so it is `trusted`
  // only when the socket's peer is a proxy the owner listed.
  readonly connectingIP: {
    readonly address: string;
    readonly provenance: 'trusted' | 'unverified';
  } | null;
  readonly userAgent: string | null;
}

export type SecurityOutcome =
  | { readonly kind: 'authorize_started'; readonly outcome: 'accepted' }
  | {
      readonly kind: 'authorize_started';
      readonly outcome: 'rejected';
      readonly reason: 'rate_limited';
    }
  | {
      readonly kind: 'authorize_invalid';
      readonly outcome: 'rejected';
      readonly reason: AuthorizeInvalidReason;
    }
  | { readonly kind: 'owner_auth'; readonly outcome: 'succeeded' }
  | {
      readonly kind: 'owner_auth';
      readonly outcome: 'failed';
      readonly reason?: OwnerAuthFailure;
    }
  | { readonly kind: 'consent'; readonly outcome: 'allowed' }
  | { readonly kind: 'consent'; readonly outcome: 'denied'; readonly reason?: 'none_ticked' }
  | {
      readonly kind: 'token_exchange';
      readonly outcome: 'rejected';
      readonly reason: TokenExchangeReason;
    }
  | { readonly kind: 'bearer'; readonly outcome: 'rejected'; readonly reason: BearerReason };

export type OwnerAuthFailure =
  | 'assertion_failed'
  | 'locked'
  | 'expired'
  | 'not_enrolled'
  | 'invalid_token';

export type AuthorizeInvalidReason =
  | 'invalid_client'
  | 'client_disabled'
  | 'invalid_redirect'
  | 'unauthorized_client'
  | 'unsupported_response_type'
  | 'invalid_request'
  | 'invalid_scope'
  | 'invalid_target'
  | 'bad_host'
  | 'bad_origin'
  | 'other';

export type TokenExchangeReason =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unauthorized_client'
  | 'unsupported_grant_type'
  | 'invalid_scope'
  | 'invalid_target'
  | 'other';

export type BearerReason = 'malformed' | 'invalid_token';

export type SecurityEvent = SecurityOutcome & {
  readonly path: string;
  readonly requester: Requester;
  readonly client?: { readonly id: OAuthClientID; readonly name: string };
  readonly redirectHost?: string;
  readonly correlationID?: CorrelationID;
};

// What a valid bearer token grants: the client it was issued to, and the
// scopes it holds.
export interface VerifiedAccess {
  readonly clientID: OAuthClientID;
  readonly clientName: string;
  readonly scopes: readonly GrantScope[];
}

type MCPAuth = Awaited<ReturnType<typeof openMCPAuth>>;

// What every HTTP route reads: the server's own identity, the authorization
// server, the approvals waiting for the owner, and the passkey enrollments in
// progress.
export interface HTTPServerContext {
  // The public origin: the OAuth issuer.
  readonly origin: string;

  // `<origin>/mcp`: the one resource every token is bound to.
  readonly resource: string;
  readonly store: MCPAuth;
  readonly approvals: ApprovalState;
  readonly enrollments: EnrollmentState;

  // Receives each sign-in outcome and each refused token as a security event.
  readonly security: { readonly record: (event: SecurityEvent) => void };

  // The time the routes stamp and check expiries against.
  readonly clock: Clock;
}

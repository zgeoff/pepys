import type {
  OAuthAccessTokenID,
  OAuthClientID,
  OAuthClientRecordID,
  OAuthConsentID,
  OAuthGrantID,
  OAuthRefreshTokenID,
  OwnerSessionID,
  PasskeyID,
} from './types.ts';

// only the columns pepys reads and writes itself: better-auth owns the tables and
// their migrations. Dates are ISO 8601 strings and string lists are JSON arrays.
export interface MCPAuthSchema {
  readonly oauthClient: {
    readonly id: OAuthClientRecordID;
    readonly clientId: OAuthClientID;
    readonly name: string | null;
    readonly redirectUris: string;
    readonly createdAt: string | null;
  };
  readonly oauthAccessToken: {
    readonly id: OAuthAccessTokenID;
    readonly token: string;
    readonly clientId: OAuthClientID;
    readonly sessionId: OwnerSessionID | null;
    readonly authorizationCodeId: OAuthGrantID | null;

    // The key a token is bound to, as JSON such as `{"jkt":"…"}`; null for a
    // bearer token.
    readonly confirmation: string | null;
  };
  readonly oauthRefreshToken: {
    readonly id: OAuthRefreshTokenID;
    readonly clientId: OAuthClientID;
    readonly sessionId: OwnerSessionID | null;
    readonly authorizationCodeId: OAuthGrantID | null;
    readonly scopes: string;
    readonly createdAt: string;
    readonly expiresAt: string;
    readonly revoked: string | null;
  };
  readonly oauthConsent: { readonly id: OAuthConsentID; readonly clientId: OAuthClientID };
  readonly oauthResource: { readonly identifier: string };
  readonly session: { readonly id: OwnerSessionID; readonly expiresAt: string };

  // When each grant last reached /mcp, keyed by the grant's authorization code id.
  readonly pepys_grant_use: { readonly grant_id: OAuthGrantID; readonly last_used_at: string };

  // Each grant the grants command revoked, keyed by its authorization code id.
  // Triggers refuse a token row that carries one of these ids.
  readonly pepys_revoked_grant: { readonly grant_id: OAuthGrantID };

  // The owner's passkeys: the credential id and its COSE public key, both
  // base64url, the signature counter the authenticator last returned, and
  // its transports as a JSON array.
  readonly pepys_passkey: {
    readonly id: PasskeyID;
    readonly public_key: string;
    readonly counter: number;
    readonly transports: string;
    readonly created_at: string;
    readonly last_used_at: string | null;
  };

  // The hash of each enrollment token a host command minted and no passkey
  // has used yet.
  readonly pepys_enrollment_token: {
    readonly token_hash: string;
    readonly created_at: string;
    readonly expires_at: string;
  };
}

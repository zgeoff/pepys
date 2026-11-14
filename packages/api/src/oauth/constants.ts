// Every MCP tool the API serves reads, so read is the one scope a grant holds.
export const GRANT_SCOPES = ['read'] as const;

export type GrantScope = (typeof GRANT_SCOPES)[number];

// Every static token in the service-token file starts with this, so the auth core sends a bearer to
// the file or to the database by its first characters. It must not start with, or be the start of,
// the `svca_` that begins each access token the core issues to a service client.
export const SERVICE_TOKEN_PREFIX = 'pepys_svc_';

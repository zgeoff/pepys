// Every MCP tool the API serves reads, so read is the one scope a grant holds.
export const GRANT_SCOPES = ['read'] as const;

export type GrantScope = (typeof GRANT_SCOPES)[number];

// The auth core needs a static-token prefix to route a bearer by its first characters, though pepys
// refuses a file with a static token. It must not start with, or be the start of, the `svca_` that
// begins each access token the core issues to a service client.
export const SERVICE_TOKEN_PREFIX = 'pepys_svc_';

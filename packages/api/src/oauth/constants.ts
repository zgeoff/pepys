// Every MCP tool the API serves reads, so read is the one scope a grant holds.
export const GRANT_SCOPES = ['read'] as const;

export type GrantScope = (typeof GRANT_SCOPES)[number];

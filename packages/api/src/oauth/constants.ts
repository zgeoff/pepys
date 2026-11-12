// The routes of the API's OAuth server and its MCP endpoint. A person opens the browser routes in
// a browser, so an ingress may put them behind a sign-in that a machine client could not pass.
export const GATEWAY_PATHS = {
  browser: {
    authorize: '/oauth2/authorize',
    login: '/login',
    enroll: '/enroll',
    consent: '/consent',
    error: '/error',
  },
  machine: {
    mcp: '/mcp',

    // MCP answers at the bare origin as well, for a client configured with it and no path.
    root: '/',
    token: '/oauth2/token',
    revoke: '/oauth2/revoke',
    authorizationServerMetadata: '/.well-known/oauth-authorization-server',
    resourceMetadata: '/.well-known/oauth-protected-resource',
    mcpResourceMetadata: '/.well-known/oauth-protected-resource/mcp',
  },
} as const;

// Every MCP tool the API serves reads, so read is the one scope a grant holds.
export const GRANT_SCOPES = ['read'] as const;

export type GrantScope = (typeof GRANT_SCOPES)[number];

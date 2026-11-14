interface MCPClientConfig {
  readonly name: string;
  readonly secretEnv: string;
  readonly readTools: readonly string[];
}

// The mcp driver's one server, `pepys`: the API's `/mcp` at `origin`, signed in through the
// client_credentials grant as `client`, whose secret the driver reads from `client.secretEnv`. The
// credentials go only to the authorization server at `origin`.
export function buildMCPServers(origin: string, client: MCPClientConfig) {
  return {
    servers: {
      pepys: {
        transport: 'http' as const,
        url: `${origin}/mcp`,
        auth: {
          clientCredentials: {
            clientID: `service:${client.name}`,
            secretEnv: client.secretEnv,
            scope: 'read',
            issuer: origin,
          },
        },
        readTools: [...client.readTools],
      },
    },
  };
}

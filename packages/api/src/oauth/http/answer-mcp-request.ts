import {
  OAuthError,
  OAuthErrorCode,
  bearerAuthChallengeResponse,
} from '@modelcontextprotocol/server';
import type { AuthInfo, McpHttpHandler } from '@modelcontextprotocol/server';
import type { Access } from '@zgeoff/mcp-auth';
import type { GrantScope } from '../constants.ts';

interface MCPRequestContext {
  // The URL of the resource metadata a challenge points to.
  readonly metadataURL: string;

  // Serves the request once its token holds read.
  readonly mcp: Pick<McpHttpHandler, 'fetch'>;
}

// Answers an MCP request whose bearer token the auth core verified.
export function answerMCPRequest(
  ctx: MCPRequestContext,
  request: Request,
  access: Access<GrantScope, null>,
): Promise<Response> {
  // The server is stateless, so only a POST carries a message.
  if (request.method !== 'POST') {
    return Promise.resolve(new Response(null, { status: 405, headers: { allow: 'POST' } }));
  }

  // Every tool reads, and the server checks no scope of its own, so a token
  // without read reaches nothing.
  if (!access.scopes.includes('read')) {
    return Promise.resolve(
      bearerAuthChallengeResponse(
        new OAuthError(OAuthErrorCode.InsufficientScope, 'Insufficient scope'),
        { requiredScopes: ['read'], resourceMetadataUrl: ctx.metadataURL },
      ),
    );
  }

  // The adapter checked the header, so it holds the bearer token.
  const token = request.headers.get('authorization')?.replace(/^Bearer /iu, '') ?? '';

  const authInfo: AuthInfo = {
    token,
    clientId: access.clientID,
    scopes: [...access.scopes],
    resourceMetadataUrl: ctx.metadataURL,
  };

  return ctx.mcp.fetch(request, { authInfo });
}

import {
  OAuthError,
  OAuthErrorCode,
  bearerAuthChallengeResponse,
} from '@modelcontextprotocol/server';
import type { AuthInfo, McpHttpHandler } from '@modelcontextprotocol/server';
import type { BearerReason, HTTPServerContext, Requester } from '../auth/types.ts';
import { GATEWAY_PATHS } from '../constants.ts';
import { verifyAccessToken } from './verify-access-token.ts';

// `requester` is where the request came from, for its security events. `mcp`
// serves the request once its token verifies.
export async function answerMCPRequest(
  ctx: HTTPServerContext,
  request: Request,
  requester: Requester,
  mcp: Pick<McpHttpHandler, 'fetch'>,
): Promise<Response> {
  const path = new URL(request.url).pathname;

  const metadataURL = `${ctx.origin}${GATEWAY_PATHS.machine.mcpResourceMetadata}`;
  const authorization = request.headers.get('authorization');
  const token = /^Bearer (?<token>\S+)$/iu.exec(authorization ?? '')?.groups?.['token'];

  if (token === undefined) {
    // a request with no header at all is a client discovering the
    // authorization server, so only a header that holds no bearer token is
    // recorded.
    if (authorization !== null) {
      recordRefusedBearer(ctx, path, requester, 'malformed');
    }

    return new Response(null, {
      status: 401,
      headers: { 'www-authenticate': `Bearer resource_metadata="${metadataURL}"` },
    });
  }

  const access = await verifyAccessToken(ctx, token);

  if (access === null) {
    recordRefusedBearer(ctx, path, requester, 'invalid_token');

    return new Response(null, {
      status: 401,
      headers: {
        'www-authenticate': `Bearer error="invalid_token", resource_metadata="${metadataURL}"`,
      },
    });
  }

  // Every tool reads, and the server checks no scope of its own, so a token
  // without read reaches nothing.
  if (!access.scopes.includes('read')) {
    return bearerAuthChallengeResponse(
      new OAuthError(OAuthErrorCode.InsufficientScope, 'Insufficient scope'),
      { requiredScopes: ['read'], resourceMetadataUrl: metadataURL },
    );
  }

  const authInfo: AuthInfo = {
    token,
    clientId: access.clientID,
    scopes: [...access.scopes],
    resourceMetadataUrl: metadataURL,
  };

  return mcp.fetch(request, { authInfo });
}

// The event holds neither the header nor the token.
function recordRefusedBearer(
  ctx: HTTPServerContext,
  path: string,
  requester: Requester,
  reason: BearerReason,
): void {
  ctx.security.record({ kind: 'bearer', outcome: 'rejected', reason, path, requester });
}

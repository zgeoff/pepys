import { DEFAULT_PATHS, openMCPAuth } from '@zgeoff/mcp-auth';
import type { MCPAuth, Requester } from '@zgeoff/mcp-auth';
import type { MCPHTTPAppOptions } from '@zgeoff/mcp-auth/elysia';
import type { Server } from 'bun';
import { AUTH_TABLES } from '../auth-tables.ts';
import { GRANT_SCOPES } from '../constants.ts';
import type { GrantScope } from '../constants.ts';
import { openMCPAuthDatabase } from '../database/open-mcp-auth-database.ts';
import { createSecurityEventLog } from '../security/create-security-event-log.ts';
import { systemClock } from '../system-clock.ts';
import type { Clock } from '../system-clock.ts';
import { isLoopbackHost } from './is-loopback-host.ts';
import { normalizePublicURL } from './normalize-public-url.ts';

interface RequestHandler {
  readonly handle: (request: Request) => Promise<Response>;
}

// What the served app needs to put the OAuth routes and /mcp beside its own.
export type MCPServedOptions = Omit<MCPHTTPAppOptions<GrantScope, null>, 'mcp' | 'besidePrefix'>;

interface MCPHTTPServerOptions {
  // The address to bind; 0 as the port binds a free one.
  readonly host: string;
  readonly port: number;

  // The origin clients reach the server at; absent means the local address.
  readonly publicURL: string | null;

  // Further Host header values to accept, for a proxy that rewrites Host.
  readonly allowedHosts: readonly string[];

  // The socket peers whose `CF-Connecting-IP` header a security event
  // labels `trusted`, each exactly as the socket reports its address.
  readonly trustForwardedFrom: readonly string[];

  // The authorization server's SQLite database.
  readonly dbPath: string;

  // Creates the app the server answers with, from the options of its OAuth
  // routes.
  readonly createServedApp: (oauth: MCPServedOptions) => RequestHandler;

  // Receives one `pepys security {json}` line per sign-in outcome or refused token.
  readonly printSecurity: (line: string) => void;

  // The time the security log's windows and the auth core's own stamps run
  // on; the system clock when unset.
  readonly clock?: Clock;
}

export interface MCPHTTPServer {
  // The loopback address the server answers on, for clients on this machine.
  readonly url: string;

  // The address the server is bound to.
  readonly listening: string;

  // The public origin: the OAuth issuer.
  readonly origin: string;
  readonly stop: () => Promise<void>;
}

// The largest request body the server reads.
const MAX_REQUEST_BODY_BYTES = 1_048_576;

// How often the server drops expired tokens, sessions and abandoned grants.
const REMOVE_EXPIRED_INTERVAL_MS = 10 * 60_000;

export async function startMCPHTTPServer(options: MCPHTTPServerOptions): Promise<MCPHTTPServer> {
  const clock = options.clock ?? systemClock;

  // Normalized before binding, so an invalid public URL throws with no port
  // left bound.
  const publicOrigin = options.publicURL === null ? null : normalizePublicURL(options.publicURL);

  // The API speaks plain HTTP, so a listener other machines can reach has to
  // sit behind something that terminates TLS, and the public URL clients use
  // is that https origin.
  if (
    !isLoopbackHost(options.host) &&
    (publicOrigin === null || !publicOrigin.startsWith('https:'))
  ) {
    throw new Error(
      `listening on '${options.host}' reaches beyond this machine, so it needs an https public URL served by a TLS-terminating proxy or tunnel`,
    );
  }

  const security = createSecurityEventLog({ print: options.printSecurity, clock });

  const trustedProxies: ReadonlySet<string> = new Set(options.trustForwardedFrom);

  const holder: { app: RequestHandler | null } = { app: null };

  // The socket's peer is the requester, or the proxy or tunnel in front of
  // the API. Only a listed peer vouches for the forwarded address.
  const readRequester = (request: Request): Requester => {
    const socketAddress = server.requestIP(request)?.address ?? null;
    const connectingIP = request.headers.get('cf-connecting-ip');

    return {
      socketAddress,
      connectingIP:
        connectingIP === null
          ? null
          : {
              address: connectingIP,
              provenance:
                socketAddress !== null && trustedProxies.has(socketAddress)
                  ? 'trusted'
                  : 'unverified',
            },
      userAgent: request.headers.get('user-agent'),
    };
  };

  const handleRequest = (request: Request): Promise<Response> =>
    holder.app === null
      ? Promise.resolve(new Response(null, { status: 503 }))
      : holder.app.handle(request);

  // The port is bound before the authorization server opens, since a server
  // with no public URL takes its origin from the port.
  const server: Server<undefined> = Bun.serve({
    hostname: options.host,
    port: options.port,
    maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
    fetch: handleRequest,
  });

  const port = server.port ?? options.port;
  const local = `http://127.0.0.1:${port}`;
  const origin = publicOrigin ?? local;
  let opened: { readonly auth: MCPAuth<GrantScope, null>; readonly close: () => void };

  try {
    opened = await openAuth(options.dbPath, origin, clock, security);
  } catch (error) {
    await server.stop(true);

    throw error;
  }

  const auth = opened.auth;

  holder.app = options.createServedApp({
    auth,
    hosts: new Set([
      new URL(origin).host,
      `127.0.0.1:${port}`,
      `localhost:${port}`,
      ...options.allowedHosts,
    ]),
    origins: new Set([origin, local, `http://localhost:${port}`]),
    readRequester,
    security,
  });

  const removeExpiredTimer = setInterval(() => {
    void runRemoveExpired(auth);
  }, REMOVE_EXPIRED_INTERVAL_MS);

  return {
    url: local,
    listening: formatBindURL(options.host, port),
    origin,
    stop: async () => {
      clearInterval(removeExpiredTimer);

      await server.stop(true);
      await auth.close();

      opened.close();
      security.drain();
    },
  };
}

async function openAuth(
  dbPath: string,
  origin: string,
  clock: Clock,
  security: MCPServedOptions['security'],
) {
  const sqlite = openMCPAuthDatabase(dbPath, clock.now());

  try {
    const auth = await openMCPAuth({
      database: sqlite,
      origin,
      productName: 'pepys',
      scopes: GRANT_SCOPES,
      paths: DEFAULT_PATHS,
      tables: AUTH_TABLES,
      clock,
      security,

      // Each MCP request is answered on its own, with no stream left open
      // that a revoke would need to end.
      onGrantRevoked: () => {},
    });

    return { auth, close: () => sqlite.close() };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}

async function runRemoveExpired(auth: MCPAuth<GrantScope, null>): Promise<void> {
  try {
    await auth.removeExpired();
  } catch (error) {
    console.error('removing expired auth rows failed', error);
  }
}

// An IPv6 address takes the brackets a URL puts around it.
function formatBindURL(host: string, port: number): string {
  const bracketed = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;

  return `http://${bracketed}:${port}`;
}

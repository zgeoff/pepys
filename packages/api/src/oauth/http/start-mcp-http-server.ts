import type { Server } from 'bun';
import invariant from 'tiny-invariant';
import { APPROVAL_WINDOW_SECONDS } from '../auth/approval-window-seconds.ts';
import { createApprovalState } from '../auth/create-approval-state.ts';
import { createEnrollmentState } from '../auth/create-enrollment-state.ts';
import { createSecurityEventLog } from '../auth/create-security-event-log.ts';
import type { MCPAuthDatabase } from '../auth/mcp-auth-database.ts';
import { openMCPAuth } from '../auth/open-mcp-auth.ts';
import { systemClock } from '../auth/system-clock.ts';
import type { Clock } from '../auth/system-clock.ts';
import type { HTTPServerContext, Requester } from '../auth/types.ts';
import { GATEWAY_PATHS } from '../constants.ts';
import type { MCPHTTPAppOptions } from './create-mcp-http-app.ts';
import { isLoopbackHost } from './is-loopback-host.ts';
import { normalizePublicURL } from './normalize-public-url.ts';

interface RequestHandler {
  readonly handle: (request: Request) => Promise<Response>;
}

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

  // The authorization server's SQLite database, and the opener the entry
  // wires in for it.
  readonly dbPath: string;
  readonly openAuthDatabase: (path: string) => MCPAuthDatabase;

  // Creates the app the server answers with, from the options of its OAuth
  // routes.
  readonly createServedApp: (oauth: MCPHTTPAppOptions) => RequestHandler;

  // Receives one `pepys security {json}` line per sign-in outcome or refused token.
  readonly printSecurity: (line: string) => void;

  // How long a rotated refresh token still answers with its successor.
  readonly refreshReuseSeconds?: number;

  // The time pending approvals, their challenges, the limit on approval
  // starts, and the routes' expiries run on; the system clock when unset.
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

  const holder: { ctx: HTTPServerContext | null; app: RequestHandler | null } = {
    ctx: null,
    app: null,
  };

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

  const handleRequest = (request: Request): Promise<Response> => {
    // Bun runs a request's fetch on a later turn than the one that bound
    // the port, and that turn builds the app.
    invariant(holder.app, 'a request arrived before the server built its app');

    return holder.app.handle(request);
  };

  const server: Server<undefined> = Bun.serve({
    hostname: options.host,
    port: options.port,
    maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
    fetch: handleRequest,
  });

  const port = server.port ?? options.port;
  const local = `http://127.0.0.1:${port}`;
  const origin = publicOrigin ?? local;
  const resource = `${origin}${GATEWAY_PATHS.machine.mcp}`;

  const hosts: ReadonlySet<string> = new Set([
    new URL(origin).host,
    `127.0.0.1:${port}`,
    `localhost:${port}`,
    ...options.allowedHosts,
  ]);

  holder.app = options.createServedApp({
    hosts,
    origins: new Set([origin, local, `http://localhost:${port}`]),
    readContext: () => holder.ctx,
    readRequester,
    security,
  });

  let store: HTTPServerContext['store'];

  try {
    store = await openMCPAuth({
      dbPath: options.dbPath,
      openDatabase: options.openAuthDatabase,
      origin,
      ...(options.refreshReuseSeconds === undefined
        ? {}
        : { refreshReuseSeconds: options.refreshReuseSeconds }),
    });
  } catch (error) {
    await server.stop(true);

    throw error;
  }

  holder.ctx = {
    origin,
    resource,
    store,
    approvals: createApprovalState(APPROVAL_WINDOW_SECONDS * 1000, () => clock.now()),
    enrollments: createEnrollmentState(() => clock.now()),
    security,
    clock,
  };

  return {
    url: local,
    listening: formatBindURL(options.host, port),
    origin,
    stop: async () => {
      await server.stop(true);
      await store.close();

      security.drain();
    },
  };
}

// An IPv6 address takes the brackets a URL puts around it.
function formatBindURL(host: string, port: number): string {
  const bracketed = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;

  return `http://${bracketed}:${port}`;
}

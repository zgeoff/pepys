// The oRPC v1 calls that packages/api makes and oRPC v2 refuses. The type check proves each break:
// a ts-expect-error that no longer meets an error fails `bun run typecheck`.
import { RPCLink } from '@orpc/client/fetch';
import { os } from '@orpc/server';

export function buildBrokenV1Calls() {
  return [
    // The missing method types as an error, which the type-aware lint rejects as unsafe.
    // @ts-expect-error v2 builders have no route method, so summary and description move to meta
    // oxlint-disable-next-line typescript/no-unsafe-call, typescript/no-unsafe-return
    () => os.$context<{ requestedBy: string }>().route({ summary: 'get_note', description: 'x' }),

    // @ts-expect-error v2 RPCLink takes a path as url, and the origin in its own option
    () => new RPCLink({ url: 'http://127.0.0.1:8081/rpc' }),

    () =>
      new RPCLink({
        url: '/rpc',
        origin: 'http://pepys.test',

        // RPCLink fixes this option name. v2 passes the custom fetch a URL string where v1 passed a
        // Request, so a handler that takes a Request no longer fits.
        // @ts-expect-error the fetch option's first parameter is a string in v2
        // oxlint-disable-next-line zgeoff/function-verb
        fetch: (request: Request) => serveRequest(request),
      }),
  ];
}

// Stands in for Elysia's app.handle, which takes a Request.
function serveRequest(request: Request) {
  return Promise.resolve(new Response(request.url));
}

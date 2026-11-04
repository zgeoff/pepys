// The oRPC v1 calls that packages/api makes and oRPC v2 refuses. The type check proves each break:
// a ts-expect-error that no longer meets an error fails `bun run typecheck`.
import { RPCLink } from '@orpc/client/fetch';
import { os } from '@orpc/server';

export function buildBrokenV1Calls() {
  return [
    // @ts-expect-error v2 builders have no route method, so summary and description move to meta
    () => os.$context<{ requestedBy: string }>().route({ summary: 'get_note', description: 'x' }),

    // @ts-expect-error v2 RPCLink takes a path as url, and the origin in its own option
    () => new RPCLink({ url: 'http://127.0.0.1:8081/rpc' }),
  ];
}

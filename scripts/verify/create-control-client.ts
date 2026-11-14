import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import type { ControlContract } from './local/control-contract.ts';

export type ControlClient = ContractRouterClient<ControlContract>;

// The client of a `local` run's control server, at the `control` endpoint of its ready line, which
// serves its routes under /control.
export function createControlClient(controlURL: string): ControlClient {
  return createORPCClient(new RPCLink({ url: '/control', origin: new URL(controlURL).origin }));
}

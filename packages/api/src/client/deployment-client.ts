import type { ContractRouterClient } from '@orpc/contract';
import type { CoreContract } from '@pepys/contract';
import type { Deployment, PluginClient } from '@pepys/kit';
import type { UnionToIntersection } from 'type-fest';

// The typed client of one deployment: the core procedures, then each plug-in query by its name. A
// caller that needs one plug-in's queries alone uses the kit's PluginClient.
export type DeploymentClient<Target extends Deployment> = ContractRouterClient<CoreContract> &
  UnionToIntersection<PluginClient<Target['plugins'][number]>>;

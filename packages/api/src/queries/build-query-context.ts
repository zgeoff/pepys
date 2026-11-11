import { buildLinkRegistry } from '@pepys/kit';
import type { CheckedDeployment, StoreReader } from '@pepys/kit';
import { buildEntityKindIndex } from './entity-kinds/build-entity-kind-index.ts';
import type { QueryContext } from './types.ts';

export function buildQueryContext(store: StoreReader, deployment: CheckedDeployment): QueryContext {
  return {
    store,
    deployment,
    entityKinds: buildEntityKindIndex(deployment.consumers),
    linkRegistry: buildLinkRegistry(deployment.linkTypes),
  };
}

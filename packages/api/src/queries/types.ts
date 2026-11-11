import type { CheckedDeployment, LinkRegistry, StoreReader } from '@pepys/kit';
import type { EntityKindIndex } from './entity-kinds/build-entity-kind-index.ts';

export interface QueryContext {
  store: StoreReader;
  deployment: CheckedDeployment;
  entityKinds: EntityKindIndex;
  linkRegistry: LinkRegistry;
}

export interface QueryFailure<
  Code extends 'NOT_FOUND' | 'BAD_REQUEST' | 'SERVICE_UNAVAILABLE' =
    | 'NOT_FOUND'
    | 'BAD_REQUEST'
    | 'SERVICE_UNAVAILABLE',
> {
  code: Code;
  message: string;
}

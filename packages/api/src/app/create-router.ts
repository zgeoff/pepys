import type { ContractRouterClient } from '@orpc/contract';
import { implement } from '@orpc/server';
import { coreContract } from '@pepys/contract';
import type { CoreContract } from '@pepys/contract';
import { readEntity } from '../queries/get-entity/read-entity.ts';
import type { QueryContext } from '../queries/types.ts';

export function createRouter() {
  const api = implement(coreContract).$context<QueryContext>();

  return api.router({
    get_entity: api.get_entity.handler(async (options) => {
      const result = await readEntity(options.context, options.input.id);

      const buildNotFound = options.errors.NOT_FOUND;

      if (!result.ok) {
        throw buildNotFound({ message: result.failure.message });
      }

      return result.value;
    }),
    neighbourhood: api.neighbourhood.handler(throwNotImplemented),
    search: api.search.handler(throwNotImplemented),
    entity_history: api.entity_history.handler(throwNotImplemented),
    assert_link: api.assert_link.handler(throwNotImplemented),
    retract_link: api.retract_link.handler(throwNotImplemented),
    correct_label: api.correct_label.handler(throwNotImplemented),
  });
}

export type APIClient = ContractRouterClient<CoreContract>;

interface NotImplementedCall {
  errors: { NOT_IMPLEMENTED: () => Error };
}

function throwNotImplemented(options: NotImplementedCall): never {
  const buildNotImplemented = options.errors.NOT_IMPLEMENTED;

  throw buildNotImplemented();
}

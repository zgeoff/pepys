import type { ContractRouterClient } from '@orpc/contract';
import { ORPCError, implement } from '@orpc/server';
import { coreContract } from '@pepys/contract';
import type { CoreContract } from '@pepys/contract';
import { readEntity } from '../queries/get-entity/read-entity.ts';
import type { QueryContext } from '../queries/types.ts';

export function createRouter() {
  const api = implement(coreContract).$context<QueryContext>();

  return api.router({
    get_entity: api.get_entity.handler(async (options) => {
      const result = await readEntity(options.context, options.input.id);

      if (!result.ok) {
        throw new ORPCError(result.failure.code, { message: result.failure.message });
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

interface ProcedureCall {
  path: readonly string[];
}

function throwNotImplemented(options: ProcedureCall): never {
  throw new ORPCError('NOT_IMPLEMENTED', {
    status: 501,
    message: `${options.path.join('.')} has no handler yet`,
  });
}

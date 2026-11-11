import { oc } from '@orpc/contract';
import { openapi } from '@orpc/openapi';
import { implement } from '@orpc/server';
import type { Router } from '@orpc/server';
import { coreContract } from '@pepys/contract';
import type { AnyQueryDefinition } from '@pepys/kit';
import { z } from 'zod';
import { readEntity } from '../queries/get-entity/read-entity.ts';
import { walkNeighbourhood } from '../queries/neighbourhood/walk-neighbourhood.ts';
import type { QueryContext } from '../queries/types.ts';
import { runPluginQuery } from './run-plugin-query.ts';

// One flat router: the two core procedures and each plug-in query, by its snake case name, which
// is also its MCP tool name. The deployment check refuses a query named as a core procedure.
export function createRouter(queries: readonly AnyQueryDefinition[]): Router<QueryContext> {
  const core = implement(coreContract).$context<QueryContext>();

  const router: Record<string, Router<QueryContext>> = {
    get_entity: core.get_entity.handler(async (options) => {
      const result = await readEntity(options.context, options.input.id);

      if (!result.ok) {
        const buildError = options.errors[result.failure.code];

        throw buildError({ message: result.failure.message });
      }

      return result.value;
    }),
    neighbourhood: core.neighbourhood.handler(async (options) => {
      const result = await walkNeighbourhood(options.context, options.input);

      if (!result.ok) {
        const buildError = options.errors[result.failure.code];

        throw buildError({ message: result.failure.message });
      }

      return result.value;
    }),
  };

  for (const query of queries) {
    if (hasTransform(query)) {
      throw new Error(
        `the query ${query.name} has a zod transform, which an MCP tool schema cannot carry`,
      );
    }

    const contract = oc
      .errors({ SERVICE_UNAVAILABLE: {} })
      .meta(openapi({ description: query.description }))
      .input(query.input)
      .output(query.output);

    router[query.name] = implement(contract)
      .$context<QueryContext>()
      .handler(async (options) => {
        const result = await runPluginQuery(options.context.store, query, options.input);

        if (!result.ok) {
          const buildUnavailable = options.errors.SERVICE_UNAVAILABLE;
          const consumers = result.failure.consumers.join(', ');

          throw buildUnavailable({ message: `the consumers ${consumers} have no current version` });
        }

        return result.value;
      });
  }

  return router;
}

// zod writes no JSON Schema for the output of a transform, and throws instead.
function hasTransform(query: AnyQueryDefinition): boolean {
  try {
    z.toJSONSchema(query.input, { io: 'output' });
    z.toJSONSchema(query.output, { io: 'output' });

    return false;
  } catch {
    return true;
  }
}

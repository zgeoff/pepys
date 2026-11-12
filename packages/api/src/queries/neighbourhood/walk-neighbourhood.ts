import type { CoreOutputs, CoreParsedInputs } from '@pepys/contract';
import { neighbourhoodCaps } from '@pepys/contract';
import { isEntityID, parseEntityID } from '@pepys/kit';
import type { Result } from '@pepys/kit';
import invariant from 'tiny-invariant';
import { compareText } from '../../utils/compare-text.ts';
import type { QueryContext, QueryFailure } from '../types.ts';
import { pickLinkTypes } from './pick-link-types.ts';
import { takeHop } from './take-hop.ts';
import type { WalkState } from './take-hop.ts';

type NeighbourhoodInput = CoreParsedInputs['neighbourhood'];

type NeighbourhoodOutput = CoreOutputs['neighbourhood'];

// A breadth-first walk with one read of the link view per hop. Every consumer with a current
// version is attached, and none is required, so a consumer with none is skipped and named.
export async function walkNeighbourhood(
  context: QueryContext,
  input: NeighbourhoodInput,
): Promise<Result<NeighbourhoodOutput, QueryFailure<'NOT_FOUND' | 'BAD_REQUEST'>>> {
  const parsed = parseEntityID(input.id);

  if (!parsed.ok) {
    const message = `${input.id} is not an entity ID: ${parsed.failure.reason}`;

    return { ok: false, failure: { code: 'BAD_REQUEST', message } };
  }

  const start = input.id;

  invariant(isEntityID(start), 'text that parses as an entity ID is one');

  const kind = `${parsed.value.source}:${parsed.value.kind}`;

  if (!context.deployment.entityKinds.some((known) => known === kind)) {
    return {
      ok: false,
      failure: { code: 'NOT_FOUND', message: `no plug-in brings the kind ${kind}` },
    };
  }

  const types = pickLinkTypes(context.linkRegistry, input);

  if (!types.ok) {
    const message = `unknown link types ${types.failure.unknown.join(', ')}; the known ones are ${types.failure.known.join(', ')}`;

    return { ok: false, failure: { code: 'BAD_REQUEST', message } };
  }

  const read = await context.store.withConsumers(
    [],
    async (db, call) => {
      let state: WalkState = {
        depths: new Map([[start, 0]]),
        links: [],
        frontier: [start],
        isTruncated: false,
      };

      for (let depth = 1; depth <= input.depthLimit && state.frontier.length > 0; depth += 1) {
        const frontier = state.frontier;

        const rows =
          types.value.length === 0
            ? []
            : await db
                .selectFrom('link_effective')
                .selectAll()
                .where('type', 'in', types.value)
                .where('confidence', '>=', input.minimumConfidence)
                .where((builder) =>
                  builder.or([
                    builder('from_id', 'in', frontier),
                    builder('to_id', 'in', frontier),
                  ]),
                )
                .orderBy('type')
                .orderBy('from_id')
                .orderBy('to_id')
                .orderBy('origin')
                .limit(neighbourhoodCaps.linkReadLimit + 1)
                .execute();

        state = takeHop(state, rows, {
          depth,
          entityLimit: input.entityLimit,
          linkReadLimit: neighbourhoodCaps.linkReadLimit,
        });
      }

      const entities = await db
        .selectFrom('entity')
        .selectAll()
        .where('id', 'in', [...state.depths.keys()])
        .execute();

      return { state, entities, skipped: call.skipped };
    },
    { whenCurrent: context.deployment.consumers },
  );

  invariant(read.ok, 'a call with no required consumer always runs');

  const state = read.value.state;

  const found = new Set(read.value.entities.map((entity) => entity.id));

  const entities = read.value.entities.map((entity) =>
    Object.assign(entity, { depth: state.depths.get(entity.id) ?? 0 }),
  );

  return {
    ok: true,
    value: {
      entities: entities.toSorted(
        (first, second) => first.depth - second.depth || compareText(first.id, second.id),
      ),
      links: state.links.toSorted((first, second) => first.depth - second.depth),
      unresolved: [...state.depths.keys()].filter((id) => !found.has(id)).toSorted(),
      skippedConsumers: [...read.value.skipped],
      isTruncated: state.isTruncated,
    },
  };
}

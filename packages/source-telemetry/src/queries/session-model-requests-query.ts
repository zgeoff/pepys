import { defineQuery, entityIDSchema, isEntityID } from '@pepys/kit';
import { z } from 'zod';
import { telemetryModelRequestConsumer } from '../telemetry-model-request-consumer.ts';

const modelRequestSchema = z.object({
  id: entityIDSchema,
  product: z.string(),
  model: z.string(),
  input_tokens: z.number(),
  cache_read_tokens: z.number(),
  cache_creation_tokens: z.number(),
  output_tokens: z.number(),
  cost_usd: z.number().nullable(),
  at: z.string(),
});

// The sender writes the session of a record, so a row counts only when the caller names the sender
// that owns the session, as another plug-in's fact gives it.
export const sessionModelRequestsQuery = defineQuery({
  name: 'telemetry_session_model_requests',
  description:
    'Returns the model requests of one telemetry session, oldest first, that the named sender stored: the sender is the issuer and the subject of the identity that proved each export. A row from any other sender is left out.',
  input: z.object({
    session: z.string().min(1),
    issuer: z.string().min(1),
    subject: z.string().min(1),
  }),
  output: z.array(modelRequestSchema),
  reads: [telemetryModelRequestConsumer],
  handler: async (call) => {
    const session = call.input.session;

    // text that is no entity ID names no stored session, so it has no rows either way
    if (!isEntityID(session)) {
      return [];
    }

    const rows = await call.db
      .selectFrom('telemetry_model_request')
      .select([
        'id',
        'product',
        'model',
        'input_tokens',
        'cache_read_tokens',
        'cache_creation_tokens',
        'output_tokens',
        'cost_usd',
        'at',
      ])
      .where('session_id', '=', session)
      .where('origin_issuer', '=', call.input.issuer)
      .where('origin_subject', '=', call.input.subject)
      .orderBy('at')
      .orderBy('id')
      .execute();

    return rows;
  },
});

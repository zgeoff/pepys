import { z } from 'zod';

export const reviewRequestPayloadSchema = z.object({
  action: z.literal('review_requested'),
  pull_request: z.object({ id: z.number(), title: z.string() }),
  requested_reviewer: z.object({ id: z.number() }),
});

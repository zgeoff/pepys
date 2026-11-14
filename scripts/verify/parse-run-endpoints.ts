import type { Endpoints, LaunchLine } from '@wringer/core';
import { z } from 'zod';

const runEndpointsSchema = z.object({
  ingest: z.url(),
  api: z.url(),
  control: z.url(),
  s2: z.url(),
  s2Basin: z.string().min(1),
  s2Token: z.string().min(1),
  garage: z.url(),
  project: z.string().min(1),
  store: z.string().min(1),
  hostLog: z.string().min(1),
});

export type RunEndpoints = z.infer<typeof runEndpointsSchema>;

// The endpoints of a `local` run, from the ready line that its app prints.
export function parseRunEndpoints(endpoints: Endpoints | LaunchLine): RunEndpoints {
  return runEndpointsSchema.parse(endpoints);
}

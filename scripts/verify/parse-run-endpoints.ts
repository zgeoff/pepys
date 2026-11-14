import type { Endpoints, LaunchLine } from '@wringer/core';
import { z } from 'zod';

const runEndpointsSchema = z.object({
  ingest: z.url(),
  api: z.url(),

  // the origin of the API's /mcp and of its OAuth server, which is the API's own origin
  mcp: z.url(),
  control: z.url(),
  s2: z.url(),
  s2Basin: z.string().min(1),
  s2Token: z.string().min(1),
  garage: z.url(),
  project: z.string().min(1),
  store: z.string().min(1),
  hostLog: z.string().min(1),

  // the API's service-token file, which it reads again on SIGHUP
  serviceTokens: z.string().min(1),
});

export type RunEndpoints = z.infer<typeof runEndpointsSchema>;

// The endpoints of a `local` run, from the ready line that its app prints.
export function parseRunEndpoints(endpoints: Endpoints | LaunchLine): RunEndpoints {
  return runEndpointsSchema.parse(endpoints);
}

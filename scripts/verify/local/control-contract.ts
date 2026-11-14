import { oc } from '@orpc/contract';
import { z } from 'zod';

const hostStateSchema = z.enum(['running', 'stopped']);

// The routes of the `local` target's control server, which the verify CLI calls to stop and start
// the host and to sign identity tokens with the run's issuer.
export const controlContract = {
  health: oc.output(z.object({ host: hostStateSchema, starts: z.number().int() })),
  stopHost: oc.output(z.object({ host: hostStateSchema, exitCode: z.number().int().nullable() })),
  startHost: oc.output(z.object({ host: hostStateSchema, starts: z.number().int() })),
  signIdentityToken: oc
    .input(z.object({ subject: z.string().min(1), name: z.string().min(1) }))
    .output(z.object({ token: z.string() })),
};

export type ControlContract = typeof controlContract;

import type { DriveContext } from '@wringer/core';
import { parseRunEndpoints } from '../parse-run-endpoints.ts';
import type { RunEndpoints } from '../parse-run-endpoints.ts';

interface SkippedCheck {
  readonly skipped: string;
}

// Wraps a doctor check of a part that only the `local` run has, such as Docker or the host, and
// hands it the run's endpoints. The doctor runs every check on every target, so on any other target
// the check passes and says that it did not run.
export function makeLocalCheck<Data, Context extends Pick<DriveContext, 'target' | 'endpoints'>>(
  run: (endpoints: RunEndpoints, ctx: Context) => Promise<Data>,
): (input: unknown, ctx: Context) => Promise<Data | SkippedCheck> {
  return (_input, ctx) =>
    ctx.target === 'local'
      ? run(parseRunEndpoints(ctx.endpoints), ctx)
      : Promise.resolve({ skipped: `runs on local only, not on ${ctx.target}` });
}

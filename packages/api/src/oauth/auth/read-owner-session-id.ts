import { toTagged } from '@zgeoff/std';
import type { HTTPServerContext, OwnerSessionID } from './types.ts';

export async function readOwnerSessionID(
  ctx: HTTPServerContext,
  cookie: string | null,
): Promise<OwnerSessionID | null> {
  if (cookie === null || cookie === '') {
    return null;
  }

  const found = await ctx.store.auth.api.getSession({ headers: new Headers({ cookie }) });

  return found === null ? null : toTagged<OwnerSessionID>(found.session.id);
}

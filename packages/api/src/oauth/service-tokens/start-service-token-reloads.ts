import type { MCPAuth } from '@zgeoff/mcp-auth';
import { match } from 'ts-pattern';
import type { GrantScope } from '../constants.ts';
import { reloadServiceTokens } from './reload-service-tokens.ts';

// Each SIGHUP reads the service-token file again and logs the outcome. Reloads run one at a time,
// so an older read never lands after a newer one. The returned function stops listening and waits
// for the last reload.
export function startServiceTokenReloads(
  auth: Pick<MCPAuth<GrantScope>, 'replaceServiceTokens'>,
  path: string,
): () => Promise<void> {
  let reloading = Promise.resolve();

  const onHangUp = (): void => {
    const previous = reloading;

    reloading = (async () => {
      await previous;
      await runServiceTokenReload(auth, path);
    })();
  };

  process.on('SIGHUP', onHangUp);

  return async () => {
    process.off('SIGHUP', onHangUp);

    await reloading;
  };
}

async function runServiceTokenReload(
  auth: Pick<MCPAuth<GrantScope>, 'replaceServiceTokens'>,
  path: string,
): Promise<void> {
  try {
    const reloaded = await reloadServiceTokens(auth, path);

    match(reloaded)
      .with({ kind: 'replaced' }, (reload) => {
        console.log(`service tokens reloaded from ${path}: clients ${reload.clients}`);
      })
      .with({ kind: 'kept' }, (reload) => {
        console.error(`service tokens kept, since ${path} is not valid: ${reload.reason}`);
      })
      .exhaustive();
  } catch (error) {
    console.error(`service tokens kept, since reloading ${path} failed`, error);
  }
}

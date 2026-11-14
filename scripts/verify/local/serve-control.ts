import { implement } from '@orpc/server';
import { RPCHandler } from '@orpc/server/fetch';
import { e2eSecrets } from '../../../packages/cli/e2e/fixtures/e2e-secrets.ts';
import type { IdentityIssuer } from '../../../packages/ingest/src/sender-proof/imp-identity/test-utils/create-identity-issuer.ts';
import { controlContract } from './control-contract.ts';
import type { HostProcess } from './create-host-process.ts';

interface ControlDependencies {
  host: HostProcess;
  issuer: IdentityIssuer;
}

// A token lives 55 s at most, so a send signs a fresh one.
const tokenLifetimeSeconds = 50;

// Serves the control routes on a free port of 127.0.0.1, under /control.
export function serveControl(dependencies: ControlDependencies): Bun.Server<undefined> {
  const routes = implement(controlContract);

  const router = {
    health: routes.health.handler(() => ({
      host: dependencies.host.state(),
      starts: dependencies.host.starts(),
    })),
    stopHost: routes.stopHost.handler(async () => {
      const exitCode = await dependencies.host.stop();

      return { host: dependencies.host.state(), exitCode };
    }),
    startHost: routes.startHost.handler(() => {
      dependencies.host.start();

      return { host: dependencies.host.state(), starts: dependencies.host.starts() };
    }),
    signIdentityToken: routes.signIdentityToken.handler(async (options) => {
      const nowSeconds = Math.floor(Date.now() / 1000);

      const token = await dependencies.issuer.signToken({
        audience: e2eSecrets.identityAudience,
        subject: options.input.subject,
        name: options.input.name,
        issuedAtSeconds: nowSeconds,
        expiresAtSeconds: nowSeconds + tokenLifetimeSeconds,
      });

      return { token };
    }),
  };

  const handler = new RPCHandler(router);

  const handleRequest = async (request: Request): Promise<Response> => {
    const result = await handler.handle(request, { prefix: '/control' });

    return result.matched ? result.response : new Response('not found', { status: 404 });
  };

  return Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: handleRequest });
}

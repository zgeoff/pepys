import type { Deployment, ReceiveRoute } from './types.ts';

export function listReceiveRoutes(deployment: Deployment): ReceiveRoute[] {
  const routes: ReceiveRoute[] = [];

  for (const source of deployment.plugins.flatMap((plugin) => plugin.sources)) {
    const path = source.live;

    if (path?.kind !== 'receive') {
      continue;
    }

    const reach = path.reach ?? 'private';

    for (const route of [path.route, ...(path.ignoredRoutes ?? [])]) {
      routes.push({
        source: source.name,
        route,
        check: path.check.kind,
        reach,
        stores: route === path.route,
      });
    }
  }

  return routes;
}

import { checkDeployment } from '@pepys/kit';
import type { CheckedDeployment, DeploymentFailure, Plugin, Result } from '@pepys/kit';
import type { BuildTarget } from '../utils/pick-build-target.ts';

export interface CheckedTarget {
  // the name of the deployment, or null for a plug-in built alone
  deployment: string | null;
  checked: CheckedDeployment;
  plugins: readonly Plugin[];
}

// These checks name a part that another plug-in can bring, so a plug-in built alone cannot fail
// them.
const needsOtherPlugins: ReadonlySet<DeploymentFailure['kind']> = new Set([
  'unknown-entity-kind',
  'missing-consumer',
  'missing-stream',
]);

export function checkBuildTarget(
  target: BuildTarget,
): Result<CheckedTarget, readonly DeploymentFailure[]> {
  if (target.kind === 'deployment') {
    const checked = checkDeployment(target.deployment);

    return checked.ok
      ? {
          ok: true,
          value: {
            deployment: target.deployment.name,
            checked: checked.value,
            plugins: target.deployment.plugins,
          },
        }
      : checked;
  }

  const plugin = target.plugin;
  const checked = checkDeployment({ name: plugin.name, plugins: [plugin] });

  if (checked.ok) {
    return { ok: true, value: { deployment: null, checked: checked.value, plugins: [plugin] } };
  }

  const failures = checked.failure.filter((failure) => !needsOtherPlugins.has(failure.kind));

  if (failures.length > 0) {
    return { ok: false, failure: failures };
  }

  // The plug-in is sound alone. Checked with no parts, it still gives its settings.
  const settings = checkDeployment({
    name: plugin.name,
    plugins: [
      { ...plugin, sources: [], consumers: [], queries: [], linkTypes: [], entityKinds: [] },
    ],
  });

  return settings.ok
    ? {
        ok: true,
        value: {
          deployment: null,
          checked: {
            ...settings.value,
            sources: plugin.sources,
            consumers: plugin.consumers,
            queries: plugin.queries,
            linkTypes: plugin.linkTypes,
            entityKinds: plugin.entityKinds,
          },
          plugins: [plugin],
        },
      }
    : settings;
}

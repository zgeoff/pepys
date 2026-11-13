import {
  checkDeployment,
  defineDeployment,
  defineFactFamily,
  definePlugin,
  defineSource,
} from '@pepys/kit';
import type { CheckedDeployment, PullPath } from '@pepys/kit';
import invariant from 'tiny-invariant';
import { z } from 'zod';
import type { PullPathName } from '../pull/make-pull-runner.ts';

export type StubPulls = Partial<Record<PullPathName, Pick<PullPath, 'intervalMs' | 'pull'>>>;

// One source per name, with the pull paths given for it. Each source has two streams,
// `facts.<name>.tide` and `facts.<name>.moon`, so a pull can fill two.
export function buildStubPullDeployment(
  pullsBySource: Readonly<Record<string, StubPulls>>,
): CheckedDeployment {
  const plugins = Object.entries(pullsBySource).map(([name, pulls]) => {
    const families = (['tide', 'moon'] as const).map((family) =>
      defineFactFamily({
        stream: `facts.${name}.${family}`,
        api: `${name}/1`,
        entityKind: `${name}:${family}`,
        types: { [`${name}.${family}.turned`]: z.object({}) },
      }),
    );

    const paths = Object.fromEntries(
      Object.entries(pulls).map(([slot, pull]) => [
        slot,
        { kind: 'pull' as const, name: slot, ...pull },
      ]),
    );

    return definePlugin({ name, sources: [defineSource({ name, families, ...paths })] });
  });

  const deployment = checkDeployment(defineDeployment({ name: 'quay', plugins }));

  invariant(deployment.ok, 'the stub deployment passes the check');

  return deployment.value;
}

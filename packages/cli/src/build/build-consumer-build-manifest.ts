import type { VersionHash } from '@pepys/kit';
import type { ConsumerBuildManifest } from '@pepys/schema';
import invariant from 'tiny-invariant';
import { buildConsumerManifest } from './build-consumer-manifest.ts';
import { buildVersionHash } from './build-version-hash.ts';
import type { CheckedTarget } from './check-build-target.ts';

export interface BuiltModule {
  name: string;

  // the SHA-256 of the module's bytes
  module: VersionHash;

  // the module file, relative to the folder of consumers.json
  path: string;
}

export interface BuildManifestParameters {
  target: CheckedTarget;
  modules: readonly BuiltModule[];
}

// `consumers.json`: one whole entry per consumer of the target, in the target's order.
export function buildConsumerBuildManifest(
  parameters: BuildManifestParameters,
): ConsumerBuildManifest {
  const modules = new Map(parameters.modules.map((built) => [built.name, built]));

  return {
    kit: 1,
    deployment: parameters.target.deployment,
    consumers: parameters.target.checked.consumers.map((consumer) => {
      const built = modules.get(consumer.name);

      invariant(built !== undefined, `the build compiled no module for ${consumer.name}`);

      const manifest = buildConsumerManifest(consumer);
      const pins = {};

      return {
        name: consumer.name,
        module: built.module,
        path: built.path,
        pins,
        version: buildVersionHash({ module: built.module, pins, manifest }),
        manifest,
      };
    }),
  };
}

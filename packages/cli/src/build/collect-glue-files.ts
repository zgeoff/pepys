import { fileURLToPath } from 'node:url';
import { buildConsumerGlue } from './build-consumer-glue.ts';
import type { GlueFile } from './build-consumer-glue.ts';
import type { CheckedTarget } from './check-build-target.ts';

export interface GlueParameters {
  target: CheckedTarget;

  // The folder of the package that the command runs in. The glue of a consumer whose entry file is
  // outside it, or under a node_modules folder, is not written here.
  packageRoot: string;
}

// The glue that the package commits: that of each consumer whose entry file is the package's own.
export function collectGlueFiles(parameters: GlueParameters): GlueFile[] {
  const families = parameters.target.checked.sources.flatMap((source) => source.families);
  const root = `${parameters.packageRoot.replace(/\/+$/u, '')}/`;

  return parameters.target.plugins.flatMap((plugin) =>
    plugin.consumers
      .filter((consumer) => isOwnConsumer(consumer.entry, root))
      .flatMap((consumer) =>
        buildConsumerGlue({
          consumer,
          families,
          settings: parameters.target.checked.settings[plugin.name],
        }),
      ),
  );
}

function isOwnConsumer(entry: URL, root: string): boolean {
  const path = fileURLToPath(entry);

  return path.startsWith(root) && !path.includes('/node_modules/');
}

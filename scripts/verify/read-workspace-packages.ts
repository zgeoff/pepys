import { join } from 'node:path';
import { z } from 'zod';
import type { WorkspacePackage } from './types.ts';

const packageJSONSchema = z.object({
  name: z.string(),
  dependencies: z.record(z.string(), z.string()).optional(),
});

// The `@pepys/*` packages, and the e2e lane's logbook plug-in, which the e2e deployment loads as a
// plug-in from outside the packages. Each comes with the names of the workspace packages it depends
// on at run time, so a dev dependency, such as a test helper package, joins no feature.
export async function readWorkspacePackages(rootDir: string): Promise<WorkspacePackage[]> {
  const glob = new Bun.Glob('packages/{*,cli/e2e/fixtures/logbook-plugin}/package.json');

  const packages: WorkspacePackage[] = [];

  for await (const path of glob.scan({ cwd: rootDir })) {
    const packageJSON: unknown = await Bun.file(join(rootDir, path)).json();

    const parsed = packageJSONSchema.parse(packageJSON);

    packages.push({
      folder: path.slice(0, -'/package.json'.length),
      name: parsed.name,
      workspaceDependencies: Object.entries(parsed.dependencies ?? {})
        .filter(([, version]) => version === 'workspace:*')
        .map(([name]) => name),
    });
  }

  return packages;
}

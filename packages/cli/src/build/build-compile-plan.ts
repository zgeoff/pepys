import { join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ConsumerDeclaration, FactFamily, Result, SettingValue } from '@pepys/kit';
import type { GlueFile } from './build-consumer-glue.ts';
import { buildConsumerGlue } from './build-consumer-glue.ts';
import { buildScriptcProfile } from './build-scriptc-profile.ts';

export interface CompilePlanParameters {
  consumer: ConsumerDeclaration;
  families: readonly FactFamily[];
  settings: Readonly<Record<string, SettingValue>> | undefined;
  out: string;

  // the folder of the package that holds the entry, or undefined when no folder above it has one
  packageRoot: string | undefined;
}

export interface CompilePlan {
  // the package's `src`, which the work folder gets a copy of
  source: string;
  work: string;

  // this build's glue and the scriptc profile, to write over the copy
  files: readonly GlueFile[];

  modulePath: string;
}

// The copy of the package's `src` sits at `<out>/.work/<consumer>`. scriptc builds the entry's
// absolute path into the module, so a fixed folder gives the same module hash on every build.
export function buildCompilePlan(parameters: CompilePlanParameters): Result<CompilePlan, string> {
  const consumer = parameters.consumer;
  const entryPath = fileURLToPath(consumer.entry);

  if (parameters.packageRoot === undefined) {
    return { ok: false, failure: `the entry ${entryPath} is in no package` };
  }

  const source = join(parameters.packageRoot, 'src');
  const entryInSource = relative(source, entryPath);

  if (entryInSource.startsWith(`..${sep}`)) {
    return {
      ok: false,
      failure: `the entry ${entryPath} is outside the src folder of its package`,
    };
  }

  const work = join(parameters.out, '.work', consumer.name);

  const glue = buildConsumerGlue({
    consumer: { ...consumer, entry: pathToFileURL(join(work, 'src', entryInSource)) },
    families: parameters.families,
    settings: parameters.settings,
  });

  const profile = buildScriptcProfile({ consumer, entry: `src/${entryInSource}` });

  return {
    ok: true,
    value: {
      source,
      work,
      files: [...glue, { path: join(work, 'profile.json'), content: JSON.stringify(profile) }],
      modulePath: join(work, 'module.wasm'),
    },
  };
}

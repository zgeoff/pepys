import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type {
  ConsumerDeclaration,
  FactFamily,
  Result,
  SettingValue,
  VersionHash,
} from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import type { BuiltModule } from './build-consumer-build-manifest.ts';
import { buildConsumerGlue } from './build-consumer-glue.ts';
import { buildScriptcProfile } from './build-scriptc-profile.ts';
import { collectForbiddenImports } from './collect-forbidden-imports.ts';
import { readPackageRoot } from './read-package-root.ts';

export interface BuildTools {
  scriptc: string;
  zig: string;
  wasmTools: string;
}

export interface CompileParameters {
  consumer: ConsumerDeclaration;
  families: readonly FactFamily[];
  settings: Readonly<Record<string, SettingValue>> | undefined;
  out: string;
  tools: BuildTools;
}

// Compiles a copy of the package's `src` at `<out>/.work/<consumer>`, with this build's glue in it.
// scriptc builds the entry's absolute path into the module, so a fixed folder gives the same module
// hash on every build of the same source.
export async function compileConsumer(
  parameters: CompileParameters,
): Promise<Result<BuiltModule, string>> {
  const consumer = parameters.consumer;
  const entryPath = fileURLToPath(consumer.entry);

  const packageRoot = await readPackageRoot(dirname(entryPath));

  if (packageRoot === undefined) {
    return { ok: false, failure: `the entry ${entryPath} is in no package` };
  }

  const entryInSource = relative(join(packageRoot, 'src'), entryPath);

  if (entryInSource.startsWith(`..${sep}`)) {
    return {
      ok: false,
      failure: `the entry ${entryPath} is outside the src folder of its package`,
    };
  }

  const work = join(parameters.out, '.work', consumer.name);

  await rm(work, { recursive: true, force: true });
  await cp(join(packageRoot, 'src'), join(work, 'src'), { recursive: true });

  const glue = buildConsumerGlue({
    consumer: { ...consumer, entry: pathToFileURL(join(work, 'src', entryInSource)) },
    families: parameters.families,
    settings: parameters.settings,
  });

  for (const file of glue) {
    await mkdir(dirname(file.path), { recursive: true });

    await Bun.write(file.path, file.content);
  }

  const profile = buildScriptcProfile({ consumer, entry: `src/${entryInSource}` });

  await Bun.write(join(work, 'profile.json'), JSON.stringify(profile));

  const modulePath = join(work, 'module.wasm');

  const compiled = await runScriptc({ work, modulePath, tools: parameters.tools });

  if (!compiled.ok) {
    return { ok: false, failure: `scriptc refused ${consumer.name}:\n${compiled.failure}` };
  }

  const contract: unknown = await Bun.file(`${modulePath}.contract.json`).json();

  if (!isAttestedDeterministic(contract)) {
    return { ok: false, failure: `scriptc does not attest ${consumer.name} deterministic` };
  }

  const text = await Bun.$`${parameters.tools.wasmTools} print ${modulePath}`.quiet().text();

  const forbidden = collectForbiddenImports(text);

  if (forbidden.length > 0) {
    return { ok: false, failure: `${consumer.name} imports ${forbidden.join(', ')}` };
  }

  const bytes = await Bun.file(modulePath).bytes();

  const module = toTagged<VersionHash>(new Bun.CryptoHasher('sha256').update(bytes).digest('hex'));
  const path = `${consumer.name}/${module}.wasm`;

  await mkdir(join(parameters.out, consumer.name), { recursive: true });

  await Bun.write(join(parameters.out, path), bytes);

  return { ok: true, value: { name: consumer.name, module, path } };
}

interface ScriptcRun {
  work: string;
  modulePath: string;
  tools: BuildTools;
}

async function runScriptc(run: ScriptcRun): Promise<Result<undefined, string>> {
  const child = Bun.spawn(
    [run.tools.scriptc, 'build', '--lib', '--profile', 'profile.json', '-o', run.modulePath],
    {
      cwd: run.work,
      env: {
        ...process.env,
        SCRIPTC_TARGET: 'wasm32-wasi',
        PATH: `${dirname(run.tools.zig)}:${process.env['PATH'] ?? ''}`,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );

  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);

  return exitCode === 0
    ? { ok: true, value: undefined }
    : { ok: false, failure: `${stdout}${stderr}` };
}

function isAttestedDeterministic(contract: unknown): boolean {
  return (
    typeof contract === 'object' &&
    contract !== null &&
    'deterministic' in contract &&
    contract.deterministic === true
  );
}

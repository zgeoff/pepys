import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ConsumerDeclaration, FactFamily, Result, SettingValue } from '@pepys/kit';
import { buildBuiltModule } from './build-built-module.ts';
import { buildCompilePlan } from './build-compile-plan.ts';
import type { BuiltModule } from './build-consumer-build-manifest.ts';
import { collectForbiddenImports } from './collect-forbidden-imports.ts';
import { isAttestedDeterministic } from './is-attested-deterministic.ts';
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

// Compiles a copy of the package's `src` with this build's glue in it, as the plan lays out, and
// writes the module to the out folder once scriptc and wasm-tools pass it.
export async function compileConsumer(
  parameters: CompileParameters,
): Promise<Result<BuiltModule, string>> {
  const name = parameters.consumer.name;

  const packageRoot = await readPackageRoot(dirname(fileURLToPath(parameters.consumer.entry)));

  const plan = buildCompilePlan({ ...parameters, packageRoot });

  if (!plan.ok) {
    return plan;
  }

  const work = plan.value.work;
  const modulePath = plan.value.modulePath;

  await rm(work, { recursive: true, force: true });
  await cp(plan.value.source, join(work, 'src'), { recursive: true });

  for (const file of plan.value.files) {
    await mkdir(dirname(file.path), { recursive: true });

    await Bun.write(file.path, file.content);
  }

  const compiled = await runScriptc({ work, modulePath, tools: parameters.tools });

  if (!compiled.ok) {
    return { ok: false, failure: `scriptc refused ${name}:\n${compiled.failure}` };
  }

  const contract: unknown = await Bun.file(`${modulePath}.contract.json`).json();

  if (!isAttestedDeterministic(contract)) {
    return { ok: false, failure: `scriptc does not attest ${name} deterministic` };
  }

  const text = await Bun.$`${parameters.tools.wasmTools} print ${modulePath}`.quiet().text();

  const forbidden = collectForbiddenImports(text);

  if (forbidden.length > 0) {
    return { ok: false, failure: `${name} imports ${forbidden.join(', ')}` };
  }

  const bytes = await Bun.file(modulePath).bytes();

  const built = buildBuiltModule(name, bytes);

  await mkdir(join(parameters.out, name), { recursive: true });

  await Bun.write(join(parameters.out, built.path), bytes);

  return { ok: true, value: built };
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

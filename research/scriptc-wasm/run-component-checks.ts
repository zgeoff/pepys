import { statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildLibraryStdin } from './build-library-stdin.ts';
import { buildWITWorldModule } from './build-wit-world-module.ts';
import { formatMs } from './format-ms.ts';
import { formatWaveString } from './format-wave-string.ts';
import { isSameRun } from './is-same-run.ts';
import { parseWaveString } from './parse-wave-string.ts';
import { reviewLinkCases } from './review-link-inputs.ts';
import { deriveReviewLinks } from './review-links-library.ts';
import { runCommand } from './run-command.ts';
import { runWasmtime } from './run-wasmtime.ts';
import type { CheckReport, SpikeContext } from './types.ts';

const consumerEntry = join(import.meta.dir, 'run-review-links.ts');

// Linux caps one argument at 128 KiB, and --invoke takes the input as an argument.
const maxInvokeInputLength = 100_000;

export function runComponentChecks(
  context: SpikeContext,
  consumerModule: string,
  libraryModule: string,
): CheckReport {
  const lines: string[] = [];
  const consumerComponent = join(context.directory, 'review-links.component.wasm');
  const wasmTools = context.tools.wasmTools;

  const wrap = runCommand([
    wasmTools,
    'component',
    'new',
    consumerModule,
    '--adapt',
    `wasi_snapshot_preview1=${join(context.tools.adapters, 'wasi_snapshot_preview1.command.wasm')}`,
    '-o',
    consumerComponent,
  ]);

  if (wrap.exitCode !== 0) {
    lines.push(`component wrap failed:\n${wrap.stderr}`);

    return { isPassing: false, lines };
  }

  lines.push(
    `consumer component: ${statSync(consumerComponent).size} bytes, imports ${readWITImports(context, consumerComponent).join(', ')}`,
  );

  let isEveryRunEqual = true;

  for (const testCase of reviewLinkCases) {
    const bun = runCommand(['bun', consumerEntry], { stdin: testCase.stdin });
    const component = runWasmtime(context.tools, [consumerComponent], testCase.stdin);
    const isEqual = isSameRun(bun, component);

    isEveryRunEqual &&= isEqual;

    lines.push(
      `component ${isEqual ? 'same' : 'DIFFERENT'}: ${testCase.name}, wasmtime ${formatMs(component.elapsedMs)}`,
    );
  }

  const world = createWorldComponent(context, libraryModule);

  if (world === undefined) {
    lines.push('custom WIT world: the build failed');

    return { isPassing: false, lines };
  }

  lines.push(
    `custom WIT world component: ${statSync(world).size} bytes, imports ${readWITImports(context, world).join(', ')}`,
  );

  Object.assign(globalThis, { readPullRequestNumber: (): number => 42 });

  for (const testCase of reviewLinkCases) {
    const inputJSON = buildLibraryStdin(testCase.stdin).inputJSON;

    if (inputJSON.length > maxInvokeInputLength) {
      lines.push(`custom WIT world skipped: ${testCase.name}, the input is too long for --invoke`);
      continue;
    }

    const invoked = runWasmtime(context.tools, [
      '--invoke',
      `derive(${formatWaveString(inputJSON)})`,
      world,
    ]);

    const isEqual =
      invoked.exitCode === 0 && parseWaveString(invoked.stdout) === deriveReviewLinks(inputJSON);

    isEveryRunEqual &&= isEqual;

    lines.push(
      `custom WIT world ${isEqual ? 'same' : 'DIFFERENT'}: ${testCase.name}, wasmtime ${formatMs(invoked.elapsedMs)}`,
    );
  }

  lines.push(`components equal Bun on every input they ran: ${isEveryRunEqual ? 'yes' : 'no'}`);

  return { isPassing: isEveryRunEqual, lines };
}

const witImportPattern = /^ {2}import (?<name>[^;]+);$/gmu;

function readWITImports(context: SpikeContext, component: string): string[] {
  const wit = runCommand([context.tools.wasmTools, 'component', 'wit', component]).stdout;

  const world = wit.slice(
    wit.indexOf('world root {'),
    wit.indexOf('\n}', wit.indexOf('world root {')),
  );

  return [...world.matchAll(witImportPattern)].map((match) => match.groups?.['name'] ?? '');
}

const witDirectory = join(import.meta.dir, 'wit');
const watDirectory = join(import.meta.dir, 'wat');

// The library reactor gets WIT names and a canonical-ABI export, then a host-provider component
// fills its one host import, because the wasmtime CLI cannot supply a custom import itself.
function createWorldComponent(context: SpikeContext, libraryModule: string): string | undefined {
  const wasmTools = context.tools.wasmTools;
  const file = (name: string): string => join(context.directory, name);
  const text = runCommand([wasmTools, 'print', libraryModule]).stdout;
  const reactor = join(context.tools.adapters, 'wasi_snapshot_preview1.reactor.wasm');

  writeFileSync(file('world.wat'), buildWITWorldModule(text));

  const steps = [
    [wasmTools, 'parse', file('world.wat'), '-o', file('world-core.wasm')],
    [
      wasmTools,
      'component',
      'embed',
      join(witDirectory, 'review-links.wit'),
      file('world-core.wasm'),
      '--world',
      'review-links',
      '-o',
      file('world-embedded.wasm'),
    ],
    [
      wasmTools,
      'component',
      'new',
      file('world-embedded.wasm'),
      '--adapt',
      `wasi_snapshot_preview1=${reactor}`,
      '-o',
      file('review-links-world.wasm'),
    ],
    [wasmTools, 'parse', join(watDirectory, 'host-provider.wat'), '-o', file('host-core.wasm')],
    [
      wasmTools,
      'component',
      'embed',
      join(witDirectory, 'host-provider.wit'),
      file('host-core.wasm'),
      '--world',
      'host-provider',
      '-o',
      file('host-embedded.wasm'),
    ],
    [wasmTools, 'component', 'new', file('host-embedded.wasm'), '-o', file('host-provider.wasm')],
    [
      wasmTools,
      'compose',
      file('review-links-world.wasm'),
      '-d',
      file('host-provider.wasm'),
      '-o',
      file('composed.wasm'),
    ],
  ];

  const isBuilt = steps.every((step) => runCommand(step).exitCode === 0);

  return isBuilt ? file('composed.wasm') : undefined;
}

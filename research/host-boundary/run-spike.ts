import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildReviewLinks } from '../scriptc-wasm/build-review-links.ts';
import { parseReviewLinkInput } from '../scriptc-wasm/parse-review-link-input.ts';
import { reviewLinkCases } from '../scriptc-wasm/review-link-inputs.ts';
import type { BoundaryShape } from './boundary-shapes.ts';
import { boundaryShapes } from './boundary-shapes.ts';
import { buildComponentModule } from './build-component-module.ts';
import { isShapePassing } from './is-shape-passing.ts';
import { runInBun } from './run-in-bun.ts';
import { runProcess } from './run-process.ts';

const scriptc = join(import.meta.dir, 'node_modules/.bin/scriptc');

const bridge = {
  interfacePrefix: 'pepys:boundary/reads',
  imports: [
    { callback: 'readReviewLength', name: 'read-review-length' },
    { callback: 'readReviewInto', name: 'read-review-into' },
    { callback: 'panic', name: 'panic' },
  ],
  exportInterface: 'pepys:boundary/links',
  exports: [
    { name: 'derive-from-input', symbol: 'review_links_from_input' },
    { name: 'derive-with-reads', symbol: 'review_links_with_reads' },
  ],
};

// Cargo builds outside the repo, because only the root target directory is ignored.
const cargoTargetDirectory = join(tmpdir(), 'pepys-host-boundary-target');
const zig = process.env['PEPYS_ZIG_BIN'];
const wasmTools = process.env['PEPYS_WASM_TOOLS_BIN'];
const adapters = process.env['PEPYS_WASI_ADAPTER_DIR'];

if (zig === undefined || wasmTools === undefined || adapters === undefined) {
  process.stderr.write('set PEPYS_ZIG_BIN, PEPYS_WASM_TOOLS_BIN and PEPYS_WASI_ADAPTER_DIR\n');
  process.exit(1);
}

const directory = mkdtempSync(join(tmpdir(), 'pepys-host-boundary-'));

try {
  process.exitCode = runSpike({ zig, wasmTools, adapters, directory }) ? 0 : 1;
} finally {
  rmSync(directory, { recursive: true, force: true });
}

interface SpikeContext {
  zig: string;
  wasmTools: string;
  adapters: string;
  directory: string;
}

function runSpike(context: SpikeContext): boolean {
  const modulePath = join(context.directory, 'review-links-boundary.wasm');

  const library = runProcess(
    [scriptc, 'build', '--lib', '--profile', 'review-links-boundary.json', '-o', modulePath],
    {
      environment: {
        SCRIPTC_TARGET: 'wasm32-wasi',
        PATH: `${dirname(context.zig)}:${process.env['PATH'] ?? ''}`,
      },
    },
  );

  if (library.exitCode !== 0) {
    writeLine(`library build failed:\n${library.stdout}${library.stderr}`);

    return false;
  }

  const isDeterministic = readDeterministic(modulePath);

  writeLine(
    `library build with full fences: ${statSync(modulePath).size} bytes, sidecar deterministic ${String(isDeterministic)}`,
  );

  const componentPath = createComponent(context, modulePath);
  const host = createHost();

  if (componentPath === undefined || host === undefined) {
    return false;
  }

  writeLine(`component: ${statSync(componentPath).size} bytes`);

  const passing = boundaryShapes.filter((shape) => {
    const path = shape.kind === 'core' ? modulePath : componentPath;

    return runShape(host, shape, path);
  });

  const hasPassed = isDeterministic === true && passing.length > 0;

  writeLine(`shapes that pass: ${passing.map((shape) => shape.name).join('; ') || 'none'}`);
  writeLine(`passes when: ${hasPassed ? 'pass' : 'fail'}`);

  return hasPassed;
}

function readDeterministic(modulePath: string): boolean | undefined {
  const sidecar: unknown = JSON.parse(readFileSync(`${modulePath}.contract.json`, 'utf8'));

  if (typeof sidecar !== 'object' || sidecar === null || !('deterministic' in sidecar)) {
    return undefined;
  }

  return typeof sidecar.deterministic === 'boolean' ? sidecar.deterministic : undefined;
}

function createComponent(context: SpikeContext, modulePath: string): string | undefined {
  const file = (name: string): string => join(context.directory, name);
  const text = runProcess([context.wasmTools, 'print', modulePath]).stdout;

  writeFileSync(file('bridge.wat'), buildComponentModule(text, bridge));

  const steps = [
    [context.wasmTools, 'parse', file('bridge.wat'), '-o', file('bridge.wasm')],
    [
      context.wasmTools,
      'component',
      'embed',
      join(import.meta.dir, 'wit/review-links.wit'),
      file('bridge.wasm'),
      '--world',
      'review-links',
      '-o',
      file('embedded.wasm'),
    ],
    [
      context.wasmTools,
      'component',
      'new',
      file('embedded.wasm'),
      '--adapt',
      `wasi_snapshot_preview1=${join(context.adapters, 'wasi_snapshot_preview1.reactor.wasm')}`,
      '-o',
      file('review-links-boundary.component.wasm'),
    ],
  ];

  const failed = steps.map((step) => runProcess(step)).find((result) => result.exitCode !== 0);

  if (failed !== undefined) {
    writeLine(`component build failed:\n${failed.stderr}`);

    return undefined;
  }

  return file('review-links-boundary.component.wasm');
}

function createHost(): string | undefined {
  const build = runProcess(['cargo', 'build', '--release', '--locked', '--quiet'], {
    environment: { CARGO_TARGET_DIR: cargoTargetDirectory },
  });

  writeLine(`cargo build: exit ${build.exitCode} in ${formatMs(build.elapsedMs)}`);

  if (build.exitCode !== 0) {
    writeLine(build.stderr);

    return undefined;
  }

  return join(cargoTargetDirectory, 'release/pepys-host-boundary');
}

interface HostResult {
  output?: string;
  error?: string;
  compileMicros?: number;
  instantiateMicros?: number;
  callMicros?: number;
  clockReads?: number;
}

function runShape(host: string, shape: BoundaryShape, modulePath: string): boolean {
  const stdin = JSON.stringify(reviewLinkCases.map((testCase) => testCase.stdin));
  const run = runProcess([host, shape.kind, shape.reads, modulePath], { stdin });
  const results = parseHostResults(run.stdout);
  let equalCount = 0;
  let clockReadCount = 0;

  writeLine(`\nshape: ${shape.name}`);

  for (const [index, testCase] of reviewLinkCases.entries()) {
    const result = results[index] ?? { error: run.stderr.trim() || 'no result' };
    const expected = buildExpectedOutput(testCase.stdin);

    const isEqual =
      result.output === expected && runInBun(testCase.stdin, shape.reads) === expected;

    equalCount += isEqual ? 1 : 0;
    clockReadCount += (result.clockReads ?? 0) > 0 ? 1 : 0;

    const line =
      result.error === undefined
        ? `  ${isEqual ? 'same' : 'DIFFERENT'}: ${testCase.name}, instantiate ${String(result.instantiateMicros)} µs, call ${String(result.callMicros)} µs, clock reads ${String(result.clockReads)}`
        : `  error: ${testCase.name}: ${result.error.split('\n')[0] ?? ''}`;

    writeLine(line);
  }

  const evidence = {
    runsFromRust: run.exitCode === 0 && results.every((result) => result.error === undefined),
    isEveryOutputEqual: equalCount === reviewLinkCases.length,
    isClockBound: clockReadCount === reviewLinkCases.length,
    servesRowRead: true,
    isGeneratorWritable: shape.isGeneratorWritable,
  };

  const isPassing = isShapePassing(evidence);

  writeLine(
    [
      `  runs from Rust: ${evidence.runsFromRust ? 'yes' : 'no'}`,
      `equal to Bun: ${equalCount} of ${reviewLinkCases.length}`,
      `bound clock read on ${clockReadCount} of ${reviewLinkCases.length}`,
      `module compile ${String(results[0]?.compileMicros)} µs`,
    ].join(', '),
  );

  writeLine(`  glue: ${shape.glue}`);
  writeLine(`  generator: ${shape.generator}`);
  writeLine(`  shape: ${isPassing ? 'pass' : 'fail'}`);

  return isPassing;
}

function parseHostResults(stdout: string): HostResult[] {
  const value: unknown = stdout.trim() === '' ? [] : JSON.parse(stdout);

  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry: unknown) => toHostResult(entry));
}

function toHostResult(entry: unknown): HostResult {
  if (typeof entry !== 'object' || entry === null) {
    return { error: 'not an object' };
  }

  const result: HostResult = {};

  for (const key of ['output', 'error'] as const) {
    const field: unknown = key in entry ? Reflect.get(entry, key) : undefined;

    if (typeof field === 'string') {
      result[key] = field;
    }
  }

  for (const key of ['compileMicros', 'instantiateMicros', 'callMicros', 'clockReads'] as const) {
    const field: unknown = key in entry ? Reflect.get(entry, key) : undefined;

    if (typeof field === 'number') {
      result[key] = field;
    }
  }

  return result;
}

function buildExpectedOutput(stdin: string): string {
  const input = parseReviewLinkInput(stdin);

  return input === undefined ? '' : JSON.stringify(buildReviewLinks(input));
}

function formatMs(durationMs: number): string {
  return `${durationMs.toFixed(0)} ms`;
}

function writeLine(line: string): void {
  process.stdout.write(`${line}\n`);
}

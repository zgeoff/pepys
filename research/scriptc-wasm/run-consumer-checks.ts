import { statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildReviewLinks } from './build-review-links.ts';
import { formatMs } from './format-ms.ts';
import { isSameRun } from './is-same-run.ts';
import { isSpikePassing } from './is-spike-passing.ts';
import { parseReviewLinkInput } from './parse-review-link-input.ts';
import { deniedNamespace, redirectClockImports } from './redirect-clock-imports.ts';
import { reviewLinkCases } from './review-link-inputs.ts';
import { runCommand } from './run-command.ts';
import { runWasmtime } from './run-wasmtime.ts';
import type { CheckReport, SpikeContext } from './types.ts';

const entry = join(import.meta.dir, 'run-review-links.ts');
const scriptc = join(import.meta.dir, 'node_modules/.bin/scriptc');

export interface ConsumerReport extends CheckReport {
  modulePath: string | undefined;
}

export function runConsumerChecks(context: SpikeContext): ConsumerReport {
  const lines: string[] = [];
  const coverage = runCommand([scriptc, 'coverage', '--fail-on', 'blockers', entry]);

  const staticLine = coverage.stdout
    .split('\n')
    .find((line) => line.includes('compile statically'));

  lines.push(`coverage: exit ${coverage.exitCode}, ${staticLine?.trim() ?? 'no summary'}`);

  const modulePath = join(context.directory, 'review-links.wasm');

  const build = runCommand(
    [scriptc, 'build', entry, '--strip', '--no-keep-llvm', '-o', modulePath],
    { zig: context.tools.zig },
  );

  if (build.exitCode !== 0) {
    lines.push(`build failed:\n${build.stderr}`);

    return { isPassing: false, lines, modulePath: undefined };
  }

  lines.push(`build: ${statSync(modulePath).size} bytes in ${formatMs(build.elapsedMs)}`);

  const text = runCommand([context.tools.wasmTools, 'print', modulePath]).stdout;
  const imports = collectImports(text);
  const forbidden = imports.filter((name) => isForbiddenImport(name));

  lines.push(
    `module kind: ${text.startsWith('(module') ? 'core module' : 'component'}`,
    `imports (${imports.length}): ${imports.join(', ')}`,
    `clock, random or network imports: ${forbidden.join(', ') || 'none'}`,
  );

  const deniedPath = writeModule(context, 'review-links-denied', redirectClockImports(text, 'own'));
  const zeroPath = writeModule(context, 'review-links-zero', redirectClockImports(text, 'denied'));
  const precompiledPath = join(context.directory, 'review-links.cwasm');

  const compile = runCommand([
    context.tools.wasmtime,
    'compile',
    '-C',
    'cache=n',
    modulePath,
    '-o',
    precompiledPath,
  ]);

  lines.push(`wasmtime compile: ${formatMs(compile.elapsedMs)}`);

  let isEveryRunEqual = true;
  let trappedRuns = 0;

  for (const testCase of reviewLinkCases) {
    const bun = runCommand(['bun', entry], { stdin: testCase.stdin });

    const wasmtime = runWasmtime(
      context.tools,
      ['--allow-precompiled', precompiledPath],
      testCase.stdin,
    );

    const refused = runWasmtime(
      context.tools,
      preloadClock('refusing', deniedPath),
      testCase.stdin,
    );

    const zero = runWasmtime(context.tools, preloadClock('zero', zeroPath), testCase.stdin);

    const trapped = runWasmtime(
      context.tools,
      preloadClock('trapping', deniedPath),
      testCase.stdin,
    );

    const hasTrapped = trapped.stderr.includes('wasm trap');
    const isEqual = isSameRun(bun, wasmtime) && isSameRun(bun, refused) && isSameRun(bun, zero);

    if (hasTrapped) {
      trappedRuns += 1;
    }

    isEveryRunEqual &&= isEqual;

    lines.push(
      [
        `${isEqual ? 'same' : 'DIFFERENT'}: ${testCase.name}`,
        `operations ${countOperations(bun.stdout)}, exit ${bun.exitCode}`,
        `bun ${formatMs(bun.elapsedMs)} (function ${formatMs(timeInProcess(testCase.stdin))})`,
        `wasmtime precompiled ${formatMs(wasmtime.elapsedMs)}`,
        `ENOSYS clock ${isSameRun(bun, refused) ? 'same' : 'DIFFERENT'}`,
        `zero clock ${isSameRun(bun, zero) ? 'same' : 'DIFFERENT'}`,
        `trapping clock ${hasTrapped ? 'trapped' : 'ran'}`,
      ].join(', '),
    );
  }

  const hasPassed = isSpikePassing({
    forbiddenImports: forbidden,
    isEveryOutputEqual: isEveryRunEqual,
  });

  // The trap count is an observation: a module with no clock import never calls the trapping clock.
  const withoutClock = forbidden.filter((name) => !name.endsWith('.clock_time_get'));

  lines.push(
    `trapping clock: ${trappedRuns} of ${reviewLinkCases.length} runs trapped`,
    `operation lists equal on every input, under the ENOSYS and the zero clock too: ${isEveryRunEqual ? 'yes' : 'no'}`,
    `passes when: ${hasPassed ? 'pass' : 'fail'}`,
    `passes when, for the same evidence without the clock import: ${isSpikePassing({ forbiddenImports: withoutClock, isEveryOutputEqual: isEveryRunEqual }) ? 'pass' : 'fail'}`,
  );

  const isVerdictSound = isVerdictSelfCheckPassing();

  lines.push(`verdict self-check on fixed evidence: ${isVerdictSound ? 'pass' : 'fail'}`);

  return { isPassing: hasPassed && isVerdictSound, lines, modulePath };
}

const importPattern = /^\s*\(import "(?<namespace>[^"]+)" "(?<name>[^"]+)"/gmu;

function collectImports(text: string): string[] {
  return [...text.matchAll(importPattern)].map(
    (match) => `${match.groups?.['namespace'] ?? ''}.${match.groups?.['name'] ?? ''}`,
  );
}

const forbiddenImportPattern = /\.(?:clock_|random_|sock_|poll_oneoff$)/u;

function isForbiddenImport(name: string): boolean {
  return forbiddenImportPattern.test(name);
}

function writeModule(context: SpikeContext, name: string, text: string): string {
  const textPath = join(context.directory, `${name}.wat`);
  const modulePath = join(context.directory, `${name}.wasm`);

  writeFileSync(textPath, text);
  runCommand([context.tools.wasmTools, 'parse', textPath, '-o', modulePath]);

  return modulePath;
}

const watDirectory = join(import.meta.dir, 'wat');

function preloadClock(clock: 'refusing' | 'trapping' | 'zero', modulePath: string): string[] {
  return [
    '--preload',
    `${deniedNamespace}=${join(watDirectory, `${clock}-clock.wat`)}`,
    modulePath,
  ];
}

function countOperations(stdout: string): number {
  const operations: unknown = stdout === '' ? [] : JSON.parse(stdout);

  return Array.isArray(operations) ? operations.length : 0;
}

function timeInProcess(stdin: string): number {
  const input = parseReviewLinkInput(stdin);
  const startMs = performance.now();

  if (input !== undefined) {
    buildReviewLinks(input);
  }

  return performance.now() - startMs;
}

function isVerdictSelfCheckPassing(): boolean {
  const clock = ['wasi_snapshot_preview1.clock_time_get'];

  return (
    isSpikePassing({ forbiddenImports: [], isEveryOutputEqual: true }) &&
    !isSpikePassing({ forbiddenImports: clock, isEveryOutputEqual: true }) &&
    !isSpikePassing({ forbiddenImports: [], isEveryOutputEqual: false })
  );
}

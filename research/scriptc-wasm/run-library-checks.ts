import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildLibraryStdin } from './build-library-stdin.ts';
import type { Review } from './build-review-links.ts';
import { buildReviewLinks } from './build-review-links.ts';
import { formatMs } from './format-ms.ts';
import { parseReviewLinkInput } from './parse-review-link-input.ts';
import { deniedNamespace, redirectClockImports } from './redirect-clock-imports.ts';
import { reviewLinkCases } from './review-link-inputs.ts';
import { deriveReviewLinks } from './review-links-library.ts';
import { runCommand } from './run-command.ts';
import type { CommandResult } from './run-command.ts';
import { runWasmtime } from './run-wasmtime.ts';
import type { CheckReport, SpikeContext } from './types.ts';

const profilePath = join(import.meta.dir, 'review-links-library.json');

export interface LibraryReport extends CheckReport {
  modulePath: string | undefined;
}

export function runLibraryChecks(context: SpikeContext): LibraryReport {
  const lines: string[] = [];
  const modulePath = join(context.directory, 'review-links-library.wasm');
  const build = runLibraryBuild(context, profilePath, modulePath);

  if (build.exitCode !== 0) {
    lines.push(`library build failed:\n${build.stdout}${build.stderr}`);

    return { isPassing: false, lines, modulePath: undefined };
  }

  const text = runCommand([context.tools.wasmTools, 'print', modulePath]).stdout;
  const isDeterministic = readDeterministic(modulePath);
  const fenceProbe = runFenceProbe(context);

  lines.push(
    `library build with full fences: ${statSync(modulePath).size} bytes, sidecar deterministic ${String(isDeterministic)}`,
    `library imports clock_time_get: ${text.includes('"clock_time_get"') ? 'yes' : 'no'}`,
    `library host import: ${text.includes('(import "scriptc" "readPullRequestNumber"') ? 'scriptc.readPullRequestNumber' : 'missing'}`,
    ...fenceProbe.lines,
  );

  const deniedTextPath = join(context.directory, 'review-links-library-denied.wat');
  const deniedPath = join(context.directory, 'review-links-library-denied.wasm');

  writeFileSync(deniedTextPath, redirectClockImports(text, 'own'));
  runCommand([context.tools.wasmTools, 'parse', deniedTextPath, '-o', deniedPath]);

  let isEveryRunEqual = true;
  let trappedRuns = 0;

  for (const testCase of reviewLinkCases) {
    const stdin = buildLibraryStdin(testCase.stdin);
    const expected = buildExpectedOutput(testCase.stdin);
    const bun = runInBun(stdin.reviews, stdin.inputJSON);
    const refused = runWasmtime(context.tools, preloadLibrary('refusing', deniedPath), stdin.bytes);
    const trapped = runWasmtime(context.tools, preloadLibrary('trapping', deniedPath), stdin.bytes);
    const hasTrapped = trapped.stderr.includes('wasm trap');
    const isEqual = refused.exitCode === 0 && refused.stdout === expected && bun === expected;

    if (hasTrapped) {
      trappedRuns += 1;
    }

    isEveryRunEqual &&= isEqual;

    lines.push(
      [
        `library ${isEqual ? 'same' : 'DIFFERENT'}: ${testCase.name}`,
        `wasmtime with ENOSYS clock ${formatMs(refused.elapsedMs)}`,
        `trapping clock ${hasTrapped ? 'trapped' : 'ran'}`,
      ].join(', '),
    );
  }

  lines.push(
    `library trapping clock: ${trappedRuns} of ${reviewLinkCases.length} runs trapped`,
    `library output equals the consumer's and Bun's on every input: ${isEveryRunEqual ? 'yes' : 'no'}`,
  );

  return {
    isPassing: isEveryRunEqual && isDeterministic === true && fenceProbe.isPassing,
    lines,
    modulePath,
  };
}

const scriptc = join(import.meta.dir, 'node_modules/.bin/scriptc');

function runLibraryBuild(
  context: SpikeContext,
  profile: string,
  modulePath: string,
): CommandResult {
  return runCommand([scriptc, 'build', '--lib', '--profile', profile, '-o', modulePath], {
    zig: context.tools.zig,
  });
}

function readDeterministic(modulePath: string): boolean | undefined {
  const sidecar: unknown = JSON.parse(readFileSync(`${modulePath}.contract.json`, 'utf8'));

  const deterministic: unknown =
    typeof sidecar === 'object' && sidecar !== null
      ? Reflect.get(sidecar, 'deterministic')
      : undefined;

  return typeof deterministic === 'boolean' ? deterministic : undefined;
}

// A scratch copy of the library adds one Date.now() call. Under the full fences the build must
// refuse it; without them the build must pass and lose the deterministic attestation.
function runFenceProbe(context: SpikeContext): CheckReport {
  const source = readFileSync(join(import.meta.dir, 'review-links-library.ts'), 'utf8')
    .replaceAll("from './", `from '${import.meta.dir}/`)
    .replace(
      'return JSON.stringify(buildReviewLinks({ ...input, reviews }));',
      'return JSON.stringify({ at: Date.now(), operations: buildReviewLinks({ ...input, reviews }) });',
    );

  const sourcePath = join(context.directory, 'dated-library.ts');
  const profile: unknown = JSON.parse(readFileSync(profilePath, 'utf8'));

  if (typeof profile !== 'object' || profile === null || !source.includes('Date.now()')) {
    return { isPassing: false, lines: ['fence probe: the scratch copy did not build'] };
  }

  const fencedProfile = join(context.directory, 'dated-fenced.json');
  const unfencedProfile = join(context.directory, 'dated-unfenced.json');
  const unfencedModule = join(context.directory, 'dated-unfenced.wasm');

  writeFileSync(sourcePath, source);
  writeFileSync(fencedProfile, JSON.stringify({ ...profile, entry: sourcePath }));

  writeFileSync(
    unfencedProfile,
    JSON.stringify({ ...profile, entry: sourcePath, determinism: undefined }),
  );

  const fenced = runLibraryBuild(
    context,
    fencedProfile,
    join(context.directory, 'dated-fenced.wasm'),
  );

  const open = runLibraryBuild(context, unfencedProfile, unfencedModule);
  const fencedOutput = `${fenced.stdout}${fenced.stderr}`;
  const isRefused = fenced.exitCode !== 0 && fencedOutput.includes('SC4008');
  const openDeterministic = open.exitCode === 0 ? readDeterministic(unfencedModule) : undefined;

  return {
    isPassing: isRefused && openDeterministic === false,
    lines: [
      `fenced Date.now(): ${isRefused ? 'refused at compile time with SC4008' : `not refused (exit ${fenced.exitCode})`}`,
      `unfenced Date.now(): build exit ${open.exitCode}, sidecar deterministic ${String(openDeterministic)}`,
    ],
  };
}

function buildExpectedOutput(stdin: string): string {
  const input = parseReviewLinkInput(stdin);

  return input === undefined ? '' : JSON.stringify(buildReviewLinks(input));
}

function runInBun(reviews: Review[], inputJSON: string): string {
  const numbers = new Map<string, number>(
    reviews.map((review) => [review.id, review.pullRequestNumber]),
  );

  Object.assign(globalThis, {
    readPullRequestNumber: (reviewID: string): number => numbers.get(reviewID) ?? -1,
  });

  return deriveReviewLinks(inputJSON);
}

const watDirectory = join(import.meta.dir, 'wat');

function preloadLibrary(clock: 'refusing' | 'trapping', modulePath: string): string[] {
  return [
    '--preload',
    `${deniedNamespace}=${join(watDirectory, `${clock}-clock.wat`)}`,
    '--preload',
    `scriptc=${join(watDirectory, 'review-host.wat')}`,
    '--preload',
    `lib=${modulePath}`,
    join(watDirectory, 'library-driver.wat'),
  ];
}

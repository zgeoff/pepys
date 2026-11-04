import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { buildCorpus } from './build-corpus.ts';
import { buildFixtureScore, collectLeaks } from './build-fixture-score.ts';
import type { FixtureScore } from './build-fixture-score.ts';
import { parserNames, runMessageParser } from './run-message-parser.ts';
import type { ParserName } from './run-message-parser.ts';
import { toParsedMessage } from './to-parsed-message.ts';
import type { ParsedMessage } from './to-parsed-message.ts';

const warmupRuns = 5;
const timedRuns = 50;
const mailDirectory = process.argv.at(2);

const exitCode =
  mailDirectory === undefined ? await runCorpus() : await runMailDirectory(mailDirectory);

process.exit(exitCode);

interface Timing {
  medianMs: number;
  maxMs: number;
}

type Outcome =
  | { kind: 'parsed'; parsed: ParsedMessage; timing: Timing }
  | { kind: 'crashed'; error: string };

interface CorpusResult {
  fixture: string;
  parser: ParserName;
  outcome: Outcome;
  score: FixtureScore | null;
}

async function runCorpus(): Promise<number> {
  const corpus = buildCorpus();
  const results: CorpusResult[] = [];

  for (const fixture of corpus) {
    for (const parser of parserNames) {
      const outcome = await runTimedParse(parser, fixture.raw);

      const score =
        outcome.kind === 'parsed' ? buildFixtureScore(fixture.expected, outcome.parsed) : null;

      results.push({ fixture: fixture.name, parser, outcome, score });
    }
  }

  const totals = parserNames.map((parser) =>
    collectTotals(
      parser,
      results.filter((result) => result.parser === parser),
    ),
  );

  const fixturesWithBody = corpus.filter(
    (fixture) => fixture.expected.textIncludes.length > 0,
  ).length;

  const passing = totals
    .filter((total) => total.crashed === 0 && total.readable === fixturesWithBody)
    .map((total) => total.parser);

  const versions = await readVersions();

  console.log(
    JSON.stringify(
      {
        versions,
        fixtures: corpus.length,
        fixturesWithBody,
        results: results.map((result) => formatResult(result)),
      },
      null,
      2,
    ),
  );

  console.log(JSON.stringify({ totals, passing }, null, 2));

  return passing.length > 0 ? 0 : 1;
}

async function runTimedParse(parser: ParserName, raw: Uint8Array): Promise<Outcome> {
  try {
    const output = await runMessageParser(parser, raw);

    const parsed = toParsedMessage(output);

    for (let run = 0; run < warmupRuns; run++) {
      await runMessageParser(parser, raw);
    }

    const durationsMs: number[] = [];

    for (let run = 0; run < timedRuns; run++) {
      const startNs = Bun.nanoseconds();

      await runMessageParser(parser, raw);

      durationsMs.push((Bun.nanoseconds() - startNs) / 1e6);
    }

    return { kind: 'parsed', parsed, timing: buildTiming(durationsMs) };
  } catch (error) {
    return {
      kind: 'crashed',
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
  }
}

function buildTiming(durationsMs: number[]): Timing {
  const sorted = durationsMs.toSorted((left, right) => left - right);

  return {
    medianMs: round(sorted[Math.floor(sorted.length / 2)] ?? 0),
    maxMs: round(sorted.at(-1) ?? 0),
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

// A message with no expected phrase has no body to read, so it counts as neither readable nor not.
function isReadable(score: FixtureScore): boolean {
  return (
    score.phrasesTotal > 0 && score.phrasesFound === score.phrasesTotal && score.leaks.length === 0
  );
}

function formatResult(result: CorpusResult): Record<string, unknown> {
  const outcome = result.outcome;
  const score = result.score;

  if (outcome.kind === 'crashed' || score === null) {
    return {
      fixture: result.fixture,
      parser: result.parser,
      crashed: outcome.kind === 'crashed' ? outcome.error : 'no score',
    };
  }

  return {
    fixture: result.fixture,
    parser: result.parser,
    readable: score.phrasesTotal === 0 ? 'no body expected' : isReadable(score),
    phrases: `${score.phrasesFound}/${score.phrasesTotal}`,
    missingPhrases: score.missingPhrases,
    textMissing: score.textMissing,
    htmlPresent: score.htmlPresent,
    leaks: score.leaks,
    subjectMatches: score.subjectMatches,
    fromNameMatches: score.fromNameMatches,
    attachments: `${score.attachmentsMatched}/${score.attachmentsExpected}`,
    attachmentProblems: score.attachmentProblems,
    headers: `${score.headersMatched}/${score.headersExpected}`,
    rfc822: score.rfc822,
    ...outcome.timing,
    text: outcome.parsed.text,
  };
}

interface Totals {
  parser: ParserName;
  crashed: number;
  readable: number;
  textMissing: number;
  subjectWrong: number;
  fromNameWrong: number;
  attachmentFixturesWrong: number;
  headersWrong: number;
  medianMsSum: number;
}

function collectTotals(parser: ParserName, results: CorpusResult[]): Totals {
  const scores = results.flatMap((result) => (result.score === null ? [] : [result.score]));

  const count = (isCounted: (score: FixtureScore) => boolean) =>
    scores.filter((score) => isCounted(score)).length;

  const medianMsSum = results.reduce(
    (sum, result) => sum + (result.outcome.kind === 'parsed' ? result.outcome.timing.medianMs : 0),
    0,
  );

  return {
    parser,
    crashed: results.filter((result) => result.outcome.kind === 'crashed').length,
    readable: count((score) => isReadable(score)),
    textMissing: count((score) => score.textMissing),
    subjectWrong: count((score) => !score.subjectMatches),
    fromNameWrong: count((score) => !score.fromNameMatches),
    attachmentFixturesWrong: count((score) => score.attachmentProblems.length > 0),
    headersWrong: count((score) => score.headersMatched < score.headersExpected),
    medianMsSum: round(medianMsSum),
  };
}

interface MailDirectoryTotals {
  crashed: string[];
  textMissing: string[];
  textMissingWithHTML: number;
  leaks: Record<string, string[]>;
  attachments: number;
  medianMsSum: number;
}

function buildMailDirectoryTotals(): MailDirectoryTotals {
  return {
    crashed: [],
    textMissing: [],
    textMissingWithHTML: 0,
    leaks: {},
    attachments: 0,
    medianMsSum: 0,
  };
}

// For the owner's export: prints counts and file names only, never a header, a body or an attachment.
async function runMailDirectory(directory: string): Promise<number> {
  const entries = await readdir(directory);

  const names = entries.filter((name) => name.endsWith('.eml')).toSorted();

  const totals = Object.fromEntries(
    parserNames.map((parser) => [parser, buildMailDirectoryTotals()]),
  );

  const attachmentCountsDiffer: string[] = [];

  for (const name of names) {
    const raw = await Bun.file(join(directory, name)).bytes();

    const attachmentCounts = new Set<number>();

    for (const parser of parserNames) {
      const outcome = await runTimedParse(parser, raw);

      const total = totals[parser];

      if (total === undefined) {
        continue;
      }

      if (outcome.kind === 'crashed') {
        total.crashed.push(name);
        continue;
      }

      const parsed = outcome.parsed;

      if (parsed.text === null || parsed.text.trim() === '') {
        total.textMissing.push(name);

        total.textMissingWithHTML += parsed.html === null ? 0 : 1;
      }

      for (const leak of collectLeaks(parsed.text ?? '')) {
        (total.leaks[leak] ??= []).push(name);
      }

      total.attachments += parsed.attachments.length;
      total.medianMsSum += outcome.timing.medianMs;

      attachmentCounts.add(parsed.attachments.length);
    }

    if (attachmentCounts.size > 1) {
      attachmentCountsDiffer.push(name);
    }
  }

  for (const total of Object.values(totals)) {
    total.medianMsSum = round(total.medianMsSum);
  }

  // Real mail has no expected phrases, so the check is no crash, some text, and no leak.
  const passing = parserNames.filter((parser) => {
    const total = totals[parser];

    return (
      total !== undefined &&
      total.crashed.length === 0 &&
      total.textMissing.length === 0 &&
      Object.keys(total.leaks).length === 0
    );
  });

  const versions = await readVersions();

  console.log(
    JSON.stringify(
      { versions, messages: names.length, totals, attachmentCountsDiffer, passing },
      null,
      2,
    ),
  );

  return passing.length > 0 ? 0 : 1;
}

async function readVersions(): Promise<Record<string, string>> {
  const packages = ['postal-mime', 'mailparser', 'html-to-text'];

  const versions = await Promise.all(packages.map((name) => readPackageVersion(name)));

  return {
    bun: Bun.version,
    ...Object.fromEntries(packages.map((name, index) => [name, versions[index] ?? 'unknown'])),
  };
}

async function readPackageVersion(name: string): Promise<string> {
  const manifest: unknown = await Bun.file(
    join(import.meta.dir, 'node_modules', name, 'package.json'),
  ).json();

  return typeof manifest === 'object' &&
    manifest !== null &&
    'version' in manifest &&
    typeof manifest.version === 'string'
    ? manifest.version
    : 'unknown';
}

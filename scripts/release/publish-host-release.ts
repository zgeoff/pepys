// Publishes the GitHub release of RELEASE_TAG with the host asset and SHA256SUMS in
// PEPYS_HOST_DIST_DIR. A deploy checks the asset against the SHA256SUMS of the same release, so this
// script never changes a published release: a rerun of the tag only checks that its two files agree.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import invariant from 'tiny-invariant';
import { isRecord } from '../utils/is-record.ts';
import { collectSumsProblems } from './collect-sums-problems.ts';
import { GLIBC_FLOOR, HOST_ASSET_NAME, SUMS_FILE_NAME } from './constants.ts';
import { pickReleaseStep } from './pick-release-step.ts';
import type { Release } from './pick-release-step.ts';
import { readSHA256 } from './read-sha256.ts';

const tag = process.env['RELEASE_TAG'];
const distDirectory = process.env['PEPYS_HOST_DIST_DIR'];

if (tag === undefined || tag === '' || distDirectory === undefined || distDirectory === '') {
  console.error('needs RELEASE_TAG and PEPYS_HOST_DIST_DIR set');
  process.exit(1);
}

// gh fills in {owner}/{repo} from GH_REPO; a release lookup by tag never returns a draft, so the
// script reads the whole list
const releasesJSON = await runGH(['api', '--paginate', '--slurp', 'repos/{owner}/{repo}/releases']);

const step = pickReleaseStep(parseReleases(releasesJSON), tag);

for (const draftID of step.staleDraftIDs) {
  await runGH(['api', '--method', 'DELETE', `repos/{owner}/{repo}/releases/${draftID}`]);

  console.log(`removed the draft release ${draftID} of ${tag}`);
}

if (step.hasPublished) {
  const problems = await readPublishedProblems(tag);

  for (const problem of problems) {
    console.error(problem);
  }

  if (problems.length > 0) {
    console.error(`the published release ${tag} has files that disagree; delete it, then rerun`);
    process.exit(1);
  }

  console.log(`the release ${tag} is published already, and its files agree`);
  process.exit(0);
}

// gh creates a draft, uploads both files, and publishes last, so a run cut off during the upload
// leaves a draft that the next run removes
const releaseURL = await runGH([
  'release',
  'create',
  tag,
  '--verify-tag',
  '--title',
  tag,
  '--notes',
  `The pepys host for linux x64, which needs glibc ${GLIBC_FLOOR} or later. Check ${HOST_ASSET_NAME} with \`sha256sum -c ${SUMS_FILE_NAME}\`.`,
  join(distDirectory, HOST_ASSET_NAME),
  join(distDirectory, SUMS_FILE_NAME),
]);

process.stdout.write(releaseURL);

async function readPublishedProblems(releaseTag: string): Promise<string[]> {
  const directory = await mkdtemp(join(tmpdir(), 'pepys-published-'));

  try {
    // a failed download stops the run here, so only files that arrived are judged
    await runGH([
      'release',
      'download',
      releaseTag,
      '--dir',
      directory,
      '--pattern',
      HOST_ASSET_NAME,
      '--pattern',
      SUMS_FILE_NAME,
    ]);

    const sumsFile = Bun.file(join(directory, SUMS_FILE_NAME));
    const asset = join(directory, HOST_ASSET_NAME);

    const hasSums = await sumsFile.exists();
    const hasAsset = await Bun.file(asset).exists();

    const sumsText = hasSums ? await sumsFile.text() : null;
    const assetSHA256 = hasAsset ? await readSHA256(asset) : null;

    return collectSumsProblems(sumsText, assetSHA256);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function runGH(args: string[]): Promise<string> {
  const child = Bun.spawn(['gh', ...args], { stdout: 'pipe', stderr: 'inherit' });

  const [output, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);

  if (exitCode !== 0) {
    console.error(`gh ${args.slice(0, 2).join(' ')} exited with ${exitCode}`);
    process.exit(1);
  }

  return output;
}

// `--slurp` wraps the pages of the list in one array
function parseReleases(text: string): Release[] {
  const pages: unknown = JSON.parse(text);

  invariant(Array.isArray(pages), 'gh api --slurp prints an array of pages');

  const pageList: readonly unknown[] = pages;
  const releases = pageList.flat();

  return releases.map((release) => {
    invariant(
      isRecord(release) &&
        typeof release['id'] === 'number' &&
        typeof release['tag_name'] === 'string' &&
        typeof release['draft'] === 'boolean',
      'GitHub gives each release an id, a tag_name and a draft flag',
    );

    return { id: release['id'], tagName: release['tag_name'], isDraft: release['draft'] };
  });
}

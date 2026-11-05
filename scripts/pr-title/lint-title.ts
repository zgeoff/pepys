// Lints the pull request title, which TITLE holds, with the commitlint rules a commit message
// meets, since a squash merge makes the title the commit subject.
import { join } from 'node:path';

const title = process.env['TITLE'];

if (title === undefined) {
  console.error('set TITLE to the pull request title');
  process.exit(1);
}

const commitlint = Bun.spawn(
  [join(import.meta.dir, '../../node_modules/.bin/commitlint'), '--verbose'],
  {
    cwd: join(import.meta.dir, '../..'),
    stdin: new TextEncoder().encode(`${title}\n`),
    stdout: 'inherit',
    stderr: 'inherit',
  },
);

const exitCode = await commitlint.exited;

process.exit(exitCode);

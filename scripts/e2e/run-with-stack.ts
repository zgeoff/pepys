// Runs the command in its arguments against a fresh stack, with the stack's addresses in the
// `PEPYS_` variables, and exits with the command's exit code.

import { buildStackEnv } from '../../stack/build-stack-env.ts';
import { withStack } from '../../stack/with-stack.ts';

const command = process.argv.slice(2);

const exitCode = await withStack((stack) => {
  const child = Bun.spawn(command, {
    env: { ...process.env, ...buildStackEnv(stack) },
    stdout: 'inherit',
    stderr: 'inherit',
  });

  return child.exited;
});

process.exit(exitCode);

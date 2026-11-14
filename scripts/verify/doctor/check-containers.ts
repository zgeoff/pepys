import { WringerError } from '@wringer/core';
import { $ } from 'bun';
import type { RunEndpoints } from '../parse-run-endpoints.ts';
import { pickContainerRefusal } from './pick-container-refusal.ts';

// The doctor's docker check: Docker answers, and the run's own compose project runs Garage and
// s2-lite.
export async function checkContainers(run: RunEndpoints): Promise<{ project: string }> {
  const label = `label=com.docker.compose.project=${run.project}`;

  const listed =
    await $`docker ps --all --filter ${label} --format ${'{{.Label "com.docker.compose.service"}} {{.State}}'}`
      .quiet()
      .nothrow();

  if (listed.exitCode !== 0) {
    throw new WringerError('environment', {
      message: `docker ps failed: ${listed.stderr.toString().trim()}`,
      hint: 'Start Docker, then run `bun verify up --restart`.',
    });
  }

  const refusal = pickContainerRefusal(listed.stdout.toString());

  if (refusal !== null) {
    throw new WringerError('check-failed', {
      message: `the compose project ${run.project}: ${refusal}`,
      hint: 'Run `bun verify up --restart`, then `bun verify doctor`.',
    });
  }

  return { project: run.project };
}

import { WringerError } from '@wringer/core';
import type { RunEndpoints } from '../parse-run-endpoints.ts';

type Service = 's2-lite' | 'garage' | 'ingest';

// The doctor's checks that a service of the run answers: s2-lite's health route answers 200,
// Garage's S3 port answers at all, and ingest's GitHub route refuses an unsigned delivery with 401.
export async function checkAnswers(run: RunEndpoints, service: Service): Promise<{ url: string }> {
  const probe = {
    's2-lite': {
      url: new URL('/health', run.s2),
      method: 'GET',
      isPass: (status: number) => status === 200,
    },
    garage: {
      url: new URL('/', run.garage),
      method: 'GET',
      isPass: (status: number) => status < 500,
    },
    ingest: {
      url: new URL('/webhook/github', run.ingest),
      method: 'POST',
      isPass: (status: number) => status === 401,
    },
  }[service];

  const response = await fetch(probe.url, { method: probe.method }).catch((error: unknown) => {
    throw new WringerError('check-failed', {
      message: `${service} at ${probe.url.origin} does not answer: ${String(error)}`,
      hint: 'Run `bun verify up --restart`, then `bun verify doctor`.',
    });
  });

  if (!probe.isPass(response.status)) {
    throw new WringerError('check-failed', {
      message: `${service} answered ${response.status} at ${probe.url.href}`,
      hint: 'Run `bun verify up --restart`, then `bun verify doctor`.',
    });
  }

  return { url: probe.url.href };
}

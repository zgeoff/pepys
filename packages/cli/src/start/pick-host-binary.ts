import type { Result } from '@pepys/kit';

const hostBinaryVariable = 'PEPYS_HOST_BIN';

export function pickHostBinary(
  environment: Readonly<Record<string, string | undefined>>,
): Result<string, string> {
  const binary = environment[hostBinaryVariable];

  if (binary === undefined || binary === '') {
    return {
      ok: false,
      failure: `pepys start needs ${hostBinaryVariable}, the path of the host binary`,
    };
  }

  return { ok: true, value: binary };
}

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Result } from '@pepys/kit';
import * as z from 'zod';

export const keyFileName = 'private-key.json';
export const machineFileName = 'machine.json';

const privateKeySchema = z.object({
  kty: z.literal('EC'),
  crv: z.literal('P-256'),
  x: z.string().min(1),
  y: z.string().min(1),
  d: z.string().min(1),
});

const machineSchema = z.object({ issuer: z.string().min(1), id: z.string().min(1) });

export type PrivateKeyJWK = z.infer<typeof privateKeySchema>;

export type Machine = z.infer<typeof machineSchema>;

export interface IdentityFiles {
  key: PrivateKeyJWK | null;
  machine: Machine | null;
}

// A file that is missing reads as null. A file that holds something else fails, so that no
// command replaces a key or an ID that it cannot read.
export async function readIdentityFiles(folder: string): Promise<Result<IdentityFiles, string>> {
  const key = await readJSONFile(join(folder, keyFileName), privateKeySchema);
  const machine = await readJSONFile(join(folder, machineFileName), machineSchema);

  if (!key.ok) {
    return key;
  }

  if (!machine.ok) {
    return machine;
  }

  return { ok: true, value: { key: key.value, machine: machine.value } };
}

async function readJSONFile<T>(
  path: string,
  schema: z.ZodType<T>,
): Promise<Result<T | null, string>> {
  let text: string;

  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return { ok: true, value: null };
    }

    return { ok: false, failure: `the file ${path} cannot be read` };
  }

  const parsed = schema.safeParse(parseJSON(text));

  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, failure: `the file ${path} does not hold what the forwarder wrote` };
}

function parseJSON(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

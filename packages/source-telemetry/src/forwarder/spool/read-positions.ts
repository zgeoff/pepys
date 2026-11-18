import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Result } from '@pepys/kit';
import * as z from 'zod';
import type { Positions } from './types.ts';

const positionsSchema = z.record(
  z.string(),
  z.object({
    offset: z.int().nonnegative(),
    sentAt: z.string().optional(),
  }),
);

// A missing file means no position yet. A file that does not parse fails.
export async function readPositions(folder: string): Promise<Result<Positions, string>> {
  let text: string;

  try {
    text = await readFile(join(folder, 'positions.json'), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return { ok: true, value: {} };
    }

    return { ok: false, failure: 'positions.json cannot be read' };
  }

  let json: unknown;

  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, failure: 'positions.json does not parse' };
  }

  const parsed = positionsSchema.safeParse(json);

  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, failure: 'positions.json does not hold a position for each file' };
}

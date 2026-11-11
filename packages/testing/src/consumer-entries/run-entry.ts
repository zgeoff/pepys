import type { ConsumerDeclaration } from '@pepys/kit';
import { ApplyError } from '../utils/apply-error.ts';

// Host functions as globals, the way the glue's `declare function` lines reach them on Bun.
export type HostFunctions = Readonly<Record<string, (...parameters: never[]) => unknown>>;

// Calls one export of the consumer's TypeScript entry with the host functions in place, and
// returns the output text. A throw, a missing export or output that is no text is an ApplyError.
export async function runEntry(
  consumer: ConsumerDeclaration,
  exportName: 'applyFact' | 'applyScope',
  argument: string,
  host: HostFunctions,
): Promise<string> {
  const failure = (reason: string) =>
    new ApplyError({ kind: 'entry', consumer: consumer.name, reason });

  const entry: unknown = await import(consumer.entry.href);

  const call =
    typeof entry === 'object' && entry !== null && exportName in entry
      ? Reflect.get(entry, exportName)
      : undefined;

  if (typeof call !== 'function') {
    throw failure(`the entry file exports no function ${exportName}`);
  }

  Object.assign(globalThis, host);

  try {
    const output: unknown = Reflect.apply(call, undefined, [argument]);

    if (typeof output !== 'string') {
      throw failure(`${exportName} returned no text`);
    }

    return output;
  } catch (error) {
    throw error instanceof ApplyError ? error : failure(`${exportName} threw: ${String(error)}`);
  } finally {
    for (const name of Object.keys(host)) {
      Reflect.deleteProperty(globalThis, name);
    }
  }
}

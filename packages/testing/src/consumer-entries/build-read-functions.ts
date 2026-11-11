import type { HostFunctions } from './run-entry.ts';

// The two host functions of one read, `<name>Length` and `<name>Into`, over JSON texts by argument.
// A length of -1 means no value. A read the texts do not hold throws, as the host's trap does.
export function buildReadFunctions(
  name: string,
  texts: ReadonlyMap<string, string>,
  missing: 'none' | 'trap',
): HostFunctions {
  const encodeText = (argument: string): Uint8Array | undefined => {
    const text = texts.get(argument);

    if (text === undefined && missing === 'trap') {
      throw new Error(`the module read ${argument}, which the host does not serve it`);
    }

    return text === undefined ? undefined : new TextEncoder().encode(text);
  };

  return {
    [`${name}Length`]: (argument: string): number => encodeText(argument)?.length ?? -1,
    [`${name}Into`]: (argument: string, buffer: Uint8Array): void => {
      buffer.set(encodeText(argument) ?? new Uint8Array());
    },
  };
}

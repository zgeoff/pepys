export type StoreRead =
  | { kind: 'read'; flags: string[]; consumerDirectory: string }
  | { kind: 'refused'; message: string };

// What the store's sqlite3 stand-in does with the arguments the db driver passes: sqlite3's flags,
// then the database, which here names a consumer's folder in the store. It reads only, because it
// answers from a copy of the consumer's current file.
export function pickStoreRead(argv: readonly string[]): StoreRead {
  const consumerDirectory = argv.at(-1);
  const flags = argv.slice(0, -1);

  if (consumerDirectory === undefined || consumerDirectory.startsWith('-')) {
    return { kind: 'refused', message: 'name the consumer folder in the store last' };
  }

  if (!flags.includes('-readonly')) {
    return {
      kind: 'refused',
      message: 'the store answers reads only; run the query without --write',
    };
  }

  return { kind: 'read', flags, consumerDirectory };
}

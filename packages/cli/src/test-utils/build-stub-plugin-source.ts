// The text of a plug-in file with one consumer that has one table. The file imports the kit and zod by
// the URL each resolves to here, so it runs from a folder outside the repo. The consumer's entry sits at
// `consumers/stub-tickets.ts` beside the file.
export function buildStubPluginSource(extraColumns: readonly string[]): string {
  const columns = ['id', ...extraColumns].map((name) =>
    name === 'id' ? `id: { kind: 'entityID' }` : `${name}: { kind: 'text' }`,
  );

  return `import { defineConsumer, definePlugin, defineSource, defineFactFamily, defineTable } from '${import.meta.resolve('@pepys/kit')}';
import { z } from '${import.meta.resolve('zod')}';

const family = defineFactFamily({
  stream: 'facts.tickets.ticket',
  api: 'tickets/1',
  entityKind: 'tickets:ticket',
  types: { 'tickets.ticket.opened': z.looseObject({}) },
});

const consumer = defineConsumer({
  name: 'stub_tickets',
  entry: new URL('consumers/stub-tickets.ts', import.meta.url),
  input: { mode: 'fact', streams: [family.stream] },
  tables: { ticket: defineTable({ columns: { ${columns.join(', ')} }, primaryKey: ['id'], indexes: [] }) },
  entityViews: [],
  reads: [],
  links: [],
});

export const plugin = definePlugin({
  name: 'tickets',
  sources: [defineSource({ name: 'tickets', families: [family] })],
  consumers: [consumer],
});
`;
}

import type { PublicPackage } from '../release/read-public-packages.ts';

// Where the outside project installs the `@pepys/*` packages from: the tarballs that `bun pm pack`
// wrote, by package name, or one version on npm.
export type OutsideSource =
  | { kind: 'tarballs'; tarballs: Readonly<Record<string, string>> }
  | { kind: 'npm'; version: string };

export interface OutsideProjectInput {
  packages: readonly PublicPackage[];
  source: OutsideSource;

  // the root catalog: the outside project pins zod, @zgeoff/std, typescript and @types/bun to it
  catalog: Readonly<Record<string, string>>;

  // `minimumReleaseAgeExcludes` of the root bunfig.toml: an outside project installs the same
  // third-party releases, so it needs the same excludes until they age past the gate
  releaseAgeExcludes: readonly string[];
}

// A plug-in's compiler checks the published TypeScript source with the plug-in's own options, so
// these are the options the kit's README tells a plug-in to set, and no more.
const consumerTSConfig = {
  compilerOptions: {
    target: 'ESNext',
    lib: ['ESNext'],
    module: 'Preserve',
    moduleResolution: 'bundler',
    allowImportingTsExtensions: true,
    verbatimModuleSyntax: true,
    noEmit: true,
    strict: true,
    skipLibCheck: true,
    types: ['bun'],
  },
};

const stubPlugin = `import {
  defineConsumer,
  defineFactFamily,
  definePlugin,
  defineQuery,
  defineSource,
  defineTable,
  entityIDSchema,
  receiveFactBatch,
} from '@pepys/kit';
import { z } from 'zod';

const bookFamily = defineFactFamily({
  stream: 'facts.shelf.book',
  api: 'shelf/1',
  entityKind: 'shelf:book',
  types: { 'shelf.book.shelved': z.object({ title: z.string() }) },
});

export const shelfSource = defineSource({
  name: 'shelf',
  families: [bookFamily],
  live: receiveFactBatch({
    route: '/shelf/facts',
    check: { kind: 'token', header: 'authorization', secretEnv: 'SHELF_TOKEN' },
  }),
});

export const shelfBookConsumer = defineConsumer({
  name: 'shelf_book',
  entry: new URL('consumers/shelf-book.ts', import.meta.url),
  input: { mode: 'fact', streams: [bookFamily.stream] },
  tables: {
    shelf_book: defineTable({
      columns: { id: { kind: 'entityID' }, title: { kind: 'text' } },
      primaryKey: ['id'],
      indexes: [],
    }),
  },
  entityViews: [],
  reads: [],
  links: [],
});

export const shelfTitleQuery = defineQuery({
  name: 'shelf_title',
  description: 'The title of one book.',
  input: z.object({ id: entityIDSchema }),
  output: z.object({ title: z.string() }),
  reads: [shelfBookConsumer],
  handler: async (call) => {
    const row = await call.db
      .selectFrom('shelf_book')
      .select('title')
      .where('id', '=', call.input.id)
      .executeTakeFirstOrThrow();

    return { title: row.title };
  },
});

export const shelfPlugin = definePlugin({
  name: 'shelf',
  sources: [shelfSource],
  consumers: [shelfBookConsumer],
  queries: [shelfTitleQuery],
});
`;

// The entry of the one consumer: a shelved fact gives the book its row.
const stubEntry = `interface BookFact {
  entity: string;
  payload: { title: string };
}

export function applyFact(factJSON: string): string {
  const fact: unknown = JSON.parse(factJSON);

  if (!isBookFact(fact)) {
    return '[]';
  }

  return JSON.stringify([{ upsert: { shelf_book: { id: fact.entity, title: fact.payload.title } } }]);
}

function isBookFact(value: unknown): value is BookFact {
  if (typeof value !== 'object' || value === null || !('entity' in value) || !('payload' in value)) {
    return false;
  }

  const payload = value.payload;

  return (
    typeof value.entity === 'string' &&
    typeof payload === 'object' &&
    payload !== null &&
    'title' in payload &&
    typeof payload.title === 'string'
  );
}
`;

const stubPluginTest = `import { expect, test } from 'bun:test';
import { createTestStore } from '@pepys/testing';
import { shelfPlugin, shelfSource, shelfTitleQuery } from './stub-plugin.ts';

test('it answers a query from the row that a shelved fact gives', async () => {
  await using store = await createTestStore({ plugins: [shelfPlugin] });

  await store.apply(shelfSource, [
    {
      type: 'shelf.book.shelved',
      event: 'evt-1',
      entity: 'shelf:book:atlas',
      at: '2026-11-01T08:00:00.000Z',
      payload: { title: 'The Coral Atlas' },
    },
  ]);

  const answer = await store.query(shelfTitleQuery, { id: 'shelf:book:atlas' });

  expect(answer).toStrictEqual({ title: 'The Coral Atlas' });
});
`;

// The files of a package that lives outside this repo: it installs every public `@pepys/*` package,
// declares a stub plug-in, and tests a query on the rows its consumer writes in the test store.
// Paths are relative to the project's folder.
export function buildOutsideProject(input: OutsideProjectInput): Record<string, string> {
  return {
    'package.json': formatManifest(input),
    'bunfig.toml': formatBunfig(input.packages, input.releaseAgeExcludes),
    'tsconfig.json': `${JSON.stringify(consumerTSConfig, null, 2)}\n`,
    'src/stub-plugin.ts': stubPlugin,
    'src/consumers/shelf-book.ts': stubEntry,
    'src/stub-plugin.test.ts': stubPluginTest,
    'src/entries.test.ts': formatEntriesTest(input.packages),
  };
}

function formatManifest(input: OutsideProjectInput): string {
  const source = input.source;
  const catalog = input.catalog;

  const pepys = Object.fromEntries(
    input.packages.map((pkg) => [
      pkg.name,
      source.kind === 'npm' ? source.version : `file:${getTarball(source.tarballs, pkg.name)}`,
    ]),
  );

  const manifest = {
    name: 'pepys-outside-check',
    private: true,
    type: 'module',
    dependencies: {
      ...pepys,
      '@zgeoff/std': getPin(catalog, '@zgeoff/std'),
      zod: getPin(catalog, 'zod'),
    },
    devDependencies: {
      '@types/bun': getPin(catalog, '@types/bun'),
      typescript: getPin(catalog, 'typescript'),
    },

    // scriptc, which `@pepys/cli` depends on, puts its native compiler in place in a postinstall
    // script, and bun runs no dependency's script that the project does not trust
    trustedDependencies: ['scriptc'],

    // a packed package names each `@pepys/*` dependency by version, which npm lacks until it is
    // published, so each one resolves to its tarball
    ...(source.kind === 'tarballs' ? { overrides: pepys } : {}),
  };

  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function getTarball(tarballs: Readonly<Record<string, string>>, name: string): string {
  const tarball = tarballs[name];

  if (tarball === undefined) {
    throw new Error(`no tarball for ${name}`);
  }

  return tarball;
}

function getPin(catalog: Readonly<Record<string, string>>, name: string): string {
  const pin = catalog[name];

  if (pin === undefined) {
    throw new Error(`the root catalog has no pin for ${name}`);
  }

  return pin;
}

// The repo's isolated linker, so a package resolves only what it declares, and its release-age gate,
// so the outside install takes no third-party version younger than the repo takes. The public
// packages and each package the repo excludes pass the gate, as in the repo.
function formatBunfig(
  packages: readonly PublicPackage[],
  releaseAgeExcludes: readonly string[],
): string {
  const excludes = [...packages.map((pkg) => pkg.name), ...releaseAgeExcludes].map(
    (name) => `  "${name}",`,
  );

  return [
    '[install]',
    'linker = "isolated"',
    'minimumReleaseAge = 604800',
    'minimumReleaseAgeExcludes = [',
    ...excludes,
    ']',
    '',
  ].join('\n');
}

// Imports every entry of every package, so the type check reads all of the published source and
// the run loads each entry with the dependencies the package declares.
function formatEntriesTest(packages: readonly PublicPackage[]): string {
  const entries = packages.flatMap((pkg) => pkg.entries);
  const imports = entries.map((entry, index) => `import * as entry${index} from '${entry}';`);
  const rows = entries.map((entry, index) => `  ['${entry}', entry${index}],`);

  return [
    "import { expect, test } from 'bun:test';",
    ...imports,
    '',
    'test.each([',
    ...rows,
    "])('it loads %s', (_entry, namespace) => {",
    '  expect(Object.keys(namespace)).not.toHaveLength(0);',
    '});',
    '',
  ].join('\n');
}

import { buildOutsideProject } from './build-outside-project.ts';
import type { OutsideProjectInput } from './build-outside-project.ts';

// `pepys build` writes the boundary file this entry imports before it compiles the entry, so the
// entry type-checks only after a build.
const shelfBookEntry = `import { initShelfBookModel, parseShelfBookFact, updateShelfBookModel } from '../generated/shelf-book-boundary.ts';
import type { ShelfBookMessage, ShelfBookModel, ShelfBookOperation } from '../generated/shelf-book-boundary.ts';

export type { ShelfBookMessage, ShelfBookModel } from '../generated/shelf-book-boundary.ts';

export function init(): ShelfBookModel {
  return initShelfBookModel();
}

export function update(model: ShelfBookModel, message: ShelfBookMessage): ShelfBookModel {
  return updateShelfBookModel(model, message);
}

export function applyFact(factJSON: string): string {
  return JSON.stringify(mapFact(factJSON));
}

function mapFact(factJSON: string): ShelfBookOperation[] {
  const fact = parseShelfBookFact(factJSON);

  if (fact === undefined) {
    return [];
  }

  return [{ upsert: { shelf_book: { id: fact.entity, title: fact.payload.title } } }];
}
`;

const deployment = `import { defineDeployment } from '@pepys/kit';
import { shelfPlugin } from './stub-plugin.ts';

export const shelfDeployment = defineDeployment({ name: 'shelf', plugins: [shelfPlugin] });
`;

const apiEntry = `import { serveAPI } from '@pepys/api';
import { shelfDeployment } from './deployment.ts';

await serveAPI({ deployment: shelfDeployment, environment: process.env, argv: process.argv.slice(2) });
`;

// A deployment compiles its API entry to one binary, as a plain and as a minified build. Bun can't
// embed the native addon that Turso's loader picks at run time, so the plugin points the loader at
// the linux-x64 package, which Bun embeds.
const compileAPIScript = `import type { BunPlugin } from 'bun';

const tursoAddon: BunPlugin = {
  name: 'turso-addon',
  setup(build) {
    build.onLoad({ filter: /[\\\\/]@tursodatabase[\\\\/]database[\\\\/]index\\.js$/ }, () => ({
      contents:
        "const binding = require('@tursodatabase/database-linux-x64-gnu');\\n" +
        'module.exports = { Database: binding.Database, EncryptionCipher: binding.EncryptionCipher };\\n',
      loader: 'js',
    }));
  },
};

for (const [outfile, minify] of [
  ['build/api/pepys-api', false],
  ['build/api/pepys-api-minified', true],
] as const) {
  await Bun.build({
    entrypoints: ['src/serve-api.ts'],
    compile: { target: 'bun-linux-x64', outfile },
    minify,
    plugins: [tursoAddon],
  });
}
`;

// The outside project with a deployment of its stub plug-in, whose consumer entry scriptc can
// compile, so `pepys build` there writes a `consumers.json` that a host runs. Its API entry and
// the script that compiles that entry let the check run the compiled API.
export function buildOutsideDeployment(input: OutsideProjectInput): Record<string, string> {
  return {
    ...buildOutsideProject(input),
    'src/consumers/shelf-book.ts': shelfBookEntry,
    'src/deployment.ts': deployment,
    'src/serve-api.ts': apiEntry,
    'compile-api.ts': compileAPIScript,
  };
}

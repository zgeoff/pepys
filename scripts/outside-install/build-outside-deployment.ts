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

// The outside project with a deployment of its stub plug-in, whose consumer entry scriptc can
// compile, so `pepys build` there writes a `consumers.json` that a host runs.
export function buildOutsideDeployment(input: OutsideProjectInput): Record<string, string> {
  return {
    ...buildOutsideProject(input),
    'src/consumers/shelf-book.ts': shelfBookEntry,
    'src/deployment.ts': deployment,
  };
}

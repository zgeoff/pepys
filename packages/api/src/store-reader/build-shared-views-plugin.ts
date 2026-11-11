import type { ConsumerDeclaration } from '@pepys/kit';
import {
  DummyDriver,
  Kysely,
  SelectQueryNode,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  sql,
} from 'kysely';
import type { KyselyPlugin, WithNode } from 'kysely';
import invariant from 'tiny-invariant';

// Turso refuses a TEMP view over an attached file, so the shared views are common table expressions
// in front of every query. Each file holds its own `entity` view, and a bare name reads the first
// attached file's alone; a common table expression of the same name wins over it.
export function buildSharedViewsPlugin(attached: readonly ConsumerDeclaration[]): KyselyPlugin {
  const views = collectSharedViews(attached);

  return {
    transformQuery: (args) => {
      if (!SelectQueryNode.is(args.node)) {
        return args.node;
      }

      return {
        ...args.node,
        with: {
          ...views,
          expressions: [...views.expressions, ...(args.node.with?.expressions ?? [])],
        },
      };
    },
    transformResult: (args) => Promise.resolve(args.result),
  };
}

// A builder that compiles and never connects: it only makes the operation nodes. Its tables are
// the attached files' own, named `<consumer>.entity` and `<consumer>.link`.
const builder = new Kysely<Record<string, Record<string, unknown>>>({
  dialect: {
    createAdapter: () => new SqliteAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (db) => new SqliteIntrospector(db),
    createQueryCompiler: () => new SqliteQueryCompiler(),
  },
});

const entityColumns = ['id', 'kind', 'title', 'url', 'actor', 'updated_at'];
const linkColumns = ['type', 'from_id', 'to_id', 'scope', 'origin', 'confidence', 'evidence'];

function collectSharedViews(attached: readonly ConsumerDeclaration[]): WithNode {
  const entityFiles = attached.filter((consumer) => consumer.entityViews.length > 0);
  const linkFiles = attached.filter((consumer) => consumer.links.length > 0);

  const withNode = builder
    .with('entity', (creator) => {
      const [first, ...rest] = entityFiles.map((consumer) =>
        creator.selectFrom(`${consumer.name}.entity`).select(entityColumns),
      );

      // no attached file has an entity view: the same columns, and no rows
      if (first === undefined) {
        return creator.selectNoFrom(entityColumns.map((column) => sql`null`.as(column))).limit(0);
      }

      return rest.reduce((union, next) => union.unionAll(next), first);
    })
    .with('link_effective', (creator) => {
      const [first, ...rest] = linkFiles.map((consumer) =>
        creator.selectFrom(`${consumer.name}.link`).select(linkColumns),
      );

      if (first === undefined) {
        return creator.selectNoFrom(linkColumns.map((column) => sql`null`.as(column))).limit(0);
      }

      return rest.reduce((union, next) => union.unionAll(next), first);
    })
    .selectNoFrom(sql`1`.as('one'))
    .toOperationNode().with;

  invariant(withNode !== undefined, 'a query with two common table expressions has a with node');

  return withNode;
}

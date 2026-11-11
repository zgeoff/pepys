import type { ConsumerDeclaration } from '@pepys/kit';
import { generateSqliteSchema } from '@pepys/kit/generators';

const hostSchema = `
CREATE TABLE "link" (
  "type" TEXT NOT NULL,
  "from_id" TEXT NOT NULL,
  "to_id" TEXT NOT NULL,
  "scope" TEXT,
  "origin" TEXT NOT NULL,
  "confidence" REAL NOT NULL,
  "evidence" TEXT NOT NULL,
  PRIMARY KEY ("origin", "type", "from_id", "to_id")
);

CREATE TABLE "scope_row" (
  "consumer" TEXT NOT NULL,
  "table_name" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  PRIMARY KEY ("consumer", "table_name", "key")
);

CREATE VIEW "link_effective" AS
SELECT "type", "from_id", "to_id", "scope", "origin", "confidence", "evidence" FROM "link";
`;

const emptyEntityView = `
CREATE VIEW "entity" AS
SELECT '' AS "id", '' AS "kind", '' AS "title", NULL AS "url", NULL AS "actor", '' AS "updated_at"
WHERE 0;
`;

// The kit writes one `entity` view per consumer file, so the one database gets a single view over
// the entity views of every consumer.
export function formatStoreSchema(consumers: readonly ConsumerDeclaration[]): string {
  const tables = consumers.map((consumer) =>
    generateSqliteSchema({ ...consumer, entityViews: [] }),
  );

  const views = consumers.flatMap((consumer) => consumer.entityViews);

  const entityView =
    views.length === 0
      ? emptyEntityView
      : generateSqliteSchema({
          name: 'entity',
          entry: new URL('file:///entity'),
          input: { mode: 'fact', streams: [] },
          tables: {},
          entityViews: views,
          reads: [],
          links: [],
        });

  return [...tables, hostSchema, entityView].join('\n');
}

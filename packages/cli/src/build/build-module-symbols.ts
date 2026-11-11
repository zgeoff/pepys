import type { ConsumerDeclaration } from '@pepys/kit';
import { toPascalCase } from '@pepys/kit/generators';
import type { ConsumerManifest, ManifestRead } from '@pepys/schema';
import { match } from 'ts-pattern';

export interface ModuleSymbols {
  // the function that the entry file exports for the host to call
  entryExport: 'applyFact' | 'applyScope';
  exports: ConsumerManifest['exports'];
  imports: ManifestRead[];
}

// The one source of the module's symbols: the scriptc profile compiles them, and the manifest tells
// the host to call and serve them. The read symbols are the names the generated glue declares.
export function buildModuleSymbols(consumer: ConsumerDeclaration): ModuleSymbols {
  const prefix = `${consumer.name}_`;

  return match(consumer.input.mode)
    .with('fact', () => ({
      entryExport: 'applyFact' as const,
      exports: { init: `${prefix}init`, apply: `${prefix}apply_fact` },
      imports: consumer.reads.map((table) => ({
        kind: 'row' as const,
        table,
        length: `read${toPascalCase(table)}Length`,
        into: `read${toPascalCase(table)}Into`,
      })),
    }))
    .with('scope', () => ({
      entryExport: 'applyScope' as const,
      exports: { init: `${prefix}init`, apply: `${prefix}apply_scope` },
      imports: [
        {
          kind: 'scope_facts' as const,
          length: 'readScopeFactsLength',
          into: 'readScopeFactsInto',
        },
      ],
    }))
    .exhaustive();
}

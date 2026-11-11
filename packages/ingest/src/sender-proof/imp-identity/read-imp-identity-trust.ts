import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Result, SourceDefinition } from '@pepys/kit';
import type { ImpIdentityVerifier } from './types.ts';

interface TrustReadOptions<Document> {
  sources: readonly SourceDefinition[];

  // the environment of the ingest process; never a request
  environment: Readonly<Record<string, string | undefined>>;
  loadIssuers: ImpIdentityVerifier<Document>['loadIssuers'];
}

// Each `issuersEnv` of the deployment names a folder of `.json` trust documents. An unset variable
// or an empty folder leaves its paths with none, so they refuse every delivery; a folder that
// cannot be read, or a document the verifier refuses, fails the start.
export async function readImpIdentityTrust<Document>(
  options: TrustReadOptions<Document>,
): Promise<Result<Map<string, readonly Document[]>, string>> {
  const trust = new Map<string, readonly Document[]>();

  for (const name of collectIssuersEnvNames(options.sources)) {
    const folder = options.environment[name] ?? '';

    if (folder === '') {
      continue;
    }

    const documents = await readFolderDocuments(folder);

    if (!documents.ok) {
      return { ok: false, failure: `${name}: ${documents.failure}` };
    }

    if (documents.value.length === 0) {
      continue;
    }

    try {
      trust.set(name, options.loadIssuers(documents.value));
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'the verifier gave no reason';

      return { ok: false, failure: `${name}: the trust documents are invalid: ${reason}` };
    }
  }

  return { ok: true, value: trust };
}

function collectIssuersEnvNames(sources: readonly SourceDefinition[]): string[] {
  const names = sources.flatMap((source) =>
    source.live?.kind === 'receive' && source.live.sender !== undefined
      ? [source.live.sender.issuersEnv]
      : [],
  );

  return [...new Set(names)];
}

async function readFolderDocuments(folder: string): Promise<Result<unknown[], string>> {
  try {
    const entries = await readdir(folder);

    const files = entries.filter((file) => file.endsWith('.json')).toSorted();
    const documents: unknown[] = [];

    for (const file of files) {
      const document: unknown = await Bun.file(join(folder, file)).json();

      documents.push(document);
    }

    return { ok: true, value: documents };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'no reason given';

    return { ok: false, failure: `the trust documents cannot be read: ${reason}` };
  }
}

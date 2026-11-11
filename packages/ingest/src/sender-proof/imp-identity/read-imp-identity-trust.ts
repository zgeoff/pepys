import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { loadIdentityIssuers } from '@impz/client/identity';
import type { IdentityTrustDocument } from '@impz/client/identity';
import type { Result, SenderRequirement, SourceDefinition } from '@pepys/kit';
import type { ImpIdentityTrust } from './types.ts';

interface TrustReadOptions {
  sources: readonly SourceDefinition[];

  // the environment of the ingest process; never a request
  environment: Readonly<Record<string, string | undefined>>;
}

// An unset or empty variable, or an empty folder, leaves its paths with no entry, so they refuse
// every delivery. A folder that cannot be read, or a document that the loader refuses, fails the
// start.
export async function readImpIdentityTrust(
  options: TrustReadOptions,
): Promise<Result<ImpIdentityTrust, string>> {
  const requirements = collectSenderRequirements(options.sources);

  const issuers = new Map<string, readonly IdentityTrustDocument[]>();
  const audiences = new Map<string, string>();

  for (const name of new Set(requirements.map((requirement) => requirement.audienceEnv))) {
    const audience = options.environment[name] ?? '';

    if (audience !== '') {
      audiences.set(name, audience);
    }
  }

  for (const name of new Set(requirements.map((requirement) => requirement.issuersEnv))) {
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
      issuers.set(name, loadIdentityIssuers(documents.value));
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'the loader gave no reason';

      return { ok: false, failure: `${name}: the trust documents are invalid: ${reason}` };
    }
  }

  return { ok: true, value: { issuers, audiences } };
}

function collectSenderRequirements(sources: readonly SourceDefinition[]): SenderRequirement[] {
  return sources.flatMap((source) =>
    source.live?.kind === 'receive' && source.live.sender !== undefined ? [source.live.sender] : [],
  );
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

import { createHash } from 'node:crypto';
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

  const trust = { issuers, audiences };
  const overlaps = collectGroupOverlaps(options.sources, trust);

  if (overlaps.length > 0) {
    return { ok: false, failure: overlaps.join('; ') };
  }

  return { ok: true, value: trust };
}

function collectSenderRequirements(sources: readonly SourceDefinition[]): SenderRequirement[] {
  return sources.flatMap((source) => {
    const path = source.live;

    if (path?.kind !== 'receive') {
      return [];
    }

    const routes = (path.senderRoutes ?? []).map((senderRoute) => senderRoute.sender);

    return path.sender === undefined ? routes : [path.sender, ...routes];
  });
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

// A token that passes a sender route must never pass its path. Each pair of a path's own `sender`
// and one of its sender routes is compared by the values loaded. A side with no audience or no
// document refuses every request, so its pair is skipped.
function collectGroupOverlaps(
  sources: readonly SourceDefinition[],
  trust: ImpIdentityTrust,
): string[] {
  const overlaps: string[] = [];

  for (const source of sources) {
    const path = source.live;

    if (path?.kind !== 'receive' || path.sender === undefined) {
      continue;
    }

    for (const senderRoute of path.senderRoutes ?? []) {
      const pair = { source: source.name, route: senderRoute.route };

      overlaps.push(
        ...collectPairOverlaps(path.sender, senderRoute.sender, trust).map(
          (reason) => `the sender route ${pair.route} of ${pair.source} ${reason}`,
        ),
      );
    }
  }

  return overlaps;
}

function collectPairOverlaps(
  own: SenderRequirement,
  other: SenderRequirement,
  trust: ImpIdentityTrust,
): string[] {
  const ownAudience = trust.audiences.get(own.audienceEnv);
  const otherAudience = trust.audiences.get(other.audienceEnv);
  const ownDocuments = trust.issuers.get(own.issuersEnv) ?? [];
  const otherDocuments = trust.issuers.get(other.issuersEnv) ?? [];

  if (ownAudience === undefined || otherAudience === undefined) {
    return [];
  }

  if (ownDocuments.length === 0 || otherDocuments.length === 0) {
    return [];
  }

  const reasons: string[] = [];

  if (ownAudience === otherAudience) {
    reasons.push('has the same audience as its path');
  }

  const ownIssuers = new Set(ownDocuments.map((document) => document.issuer));

  for (const document of otherDocuments) {
    if (ownIssuers.has(document.issuer)) {
      reasons.push(`trusts the issuer ${document.issuer}, which its path trusts too`);
    }
  }

  const ownThumbprints = new Set(
    ownDocuments.flatMap((document) => document.keys.map(buildThumbprint)),
  );

  for (const document of otherDocuments) {
    for (const key of document.keys) {
      if (ownThumbprints.has(buildThumbprint(key))) {
        reasons.push(
          `trusts a key of the issuer ${document.issuer} that its path trusts too, by thumbprint`,
        );
      }
    }
  }

  return reasons;
}

// The RFC 7638 SHA-256 thumbprint of an EC key: the required members in order, as compact JSON.
function buildThumbprint(key: IdentityTrustDocument['keys'][number]): string {
  const canonical = JSON.stringify({ crv: key.crv, kty: key.kty, x: key.x, y: key.y });

  return createHash('sha256').update(canonical).digest('base64url');
}

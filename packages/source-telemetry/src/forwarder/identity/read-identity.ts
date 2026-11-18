import type { Result } from '@pepys/kit';
import { buildKeyID } from './build-key-id.ts';
import { readIdentityFiles } from './read-identity-files.ts';
import type { Machine, PrivateKeyJWK } from './read-identity-files.ts';
import type { Identity } from './types.ts';

// The identity that the forwarder signs with. It fails when the key or the machine's ID is
// missing, because the send loop cannot start without them.
export async function readIdentity(folder: string): Promise<Result<Identity, string>> {
  const files = await readIdentityFiles(folder);

  if (!files.ok) {
    return files;
  }

  if (files.value.key === null || files.value.machine === null) {
    return {
      ok: false,
      failure: `the identity folder ${folder} holds no key or no machine ID; run the install command`,
    };
  }

  return { ok: true, value: await importIdentity(files.value.key, files.value.machine) };
}

export async function importIdentity(key: PrivateKeyJWK, machine: Machine): Promise<Identity> {
  const publicKey = { kty: key.kty, crv: key.crv, x: key.x, y: key.y } as const;

  return {
    issuer: machine.issuer,
    id: machine.id,
    kid: buildKeyID(publicKey),
    publicKey,
    privateKey: await crypto.subtle.importKey(
      'jwk',
      key,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    ),
  };
}

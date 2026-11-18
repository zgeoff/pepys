import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Result } from '@pepys/kit';
import {
  keyFileName,
  machineFileName,
  privateKeySchema,
  readIdentityFiles,
} from './read-identity-files.ts';
import type { PrivateKeyJWK } from './read-identity-files.ts';
import { importIdentity } from './read-identity.ts';
import type { Identity } from './types.ts';

interface IdentityCreation {
  folder: string;
  issuer: string;
  randomID: () => string;
}

// Makes the key and the machine's ID that the folder lacks. It never replaces a key or an ID, and
// fails when the stored issuer name differs from the one given.
export async function createIdentity(
  creation: IdentityCreation,
): Promise<Result<Identity, string>> {
  const files = await readIdentityFiles(creation.folder);

  if (!files.ok) {
    return files;
  }

  if (files.value.machine !== null && files.value.machine.issuer !== creation.issuer) {
    return {
      ok: false,
      failure: `the identity folder holds the issuer ${files.value.machine.issuer}, not ${creation.issuer}`,
    };
  }

  await mkdir(creation.folder, { recursive: true, mode: 0o700 });
  await chmod(creation.folder, 0o700);

  let key = files.value.key;

  key ??= await writeNewKey(creation.folder);

  const machine = files.value.machine ?? {
    issuer: creation.issuer,
    id: creation.randomID(),
  };

  if (files.value.machine === null) {
    await writeFile(join(creation.folder, machineFileName), `${JSON.stringify(machine)}\n`, {
      mode: 0o600,
      flag: 'wx',
    });
  }

  return { ok: true, value: await importIdentity(key, machine) };
}

async function writeNewKey(folder: string): Promise<PrivateKeyJWK> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);

  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);

  const key = privateKeySchema.parse(jwk);

  await writeFile(join(folder, keyFileName), `${JSON.stringify(key)}\n`, {
    mode: 0o600,
    flag: 'wx',
  });

  return key;
}

import { randomUUID } from 'node:crypto';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { buildTrustDocument } from '../identity/build-trust-document.ts';
import { createIdentity } from '../identity/create-identity.ts';
import { isCachedBin } from './is-cached-bin.ts';
import { hasControlCharacter, parseInstallArguments } from './parse-install-arguments.ts';
import { renderUnit } from './render-unit.ts';

interface InstallDependencies {
  argv: readonly string[];
  environment: Readonly<Record<string, string | undefined>>;
  home: string;

  // the path of the package's bin file, and of the bun that runs it
  binPath: string;
  bunPath: string;
  stdout: { write: (text: string) => unknown };
  stderr: { write: (text: string) => unknown };
}

const copiedSettings = [
  'PEPYS_FORWARDER_HOST',
  'PEPYS_FORWARDER_PORT',
  'PEPYS_FORWARDER_SPOOL_DIR',
  'PEPYS_FORWARDER_IDENTITY_DIR',
] as const;

// The `install` command. It returns the exit code. It enables and starts nothing.
export async function runInstall(dependencies: InstallDependencies): Promise<number> {
  const fail = (reason: string): number => {
    dependencies.stderr.write(`install failed: ${reason}\n`);

    return 1;
  };

  const parsed = parseInstallArguments(dependencies.argv);

  if (!parsed.ok) {
    return fail(parsed.failure);
  }

  const bin = await realpath(dependencies.binPath);

  if (isCachedBin(bin)) {
    return fail(
      `the bin file ${bin} is in a bunx cache; install the package with bun add --global`,
    );
  }

  const copied: Record<string, string> = {};

  for (const name of copiedSettings) {
    const value = dependencies.environment[name];

    if (value !== undefined && value !== '') {
      if (hasControlCharacter(value)) {
        return fail(`${name} holds a control character`);
      }

      copied[name] = value;
    }
  }

  const identityDir =
    copied['PEPYS_FORWARDER_IDENTITY_DIR'] ??
    join(dependencies.home, '.config/pepys-telemetry-forwarder');

  const identity = await createIdentity({
    folder: identityDir,
    issuer: parsed.value.issuer,
    randomID: randomUUID,
  });

  if (!identity.ok) {
    return fail(identity.failure);
  }

  const unitPath = join(
    dependencies.home,
    '.config/systemd/user/pepys-telemetry-forwarder.service',
  );

  await mkdir(dirname(unitPath), { recursive: true });

  await writeFile(
    unitPath,
    renderUnit({
      bun: dependencies.bunPath,
      bin,
      issuer: parsed.value.issuer,
      audience: parsed.value.audience,
      ingestURL: parsed.value.ingestURL,
      copied,
    }),
  );

  dependencies.stdout.write(`${JSON.stringify(buildTrustDocument(identity.value), null, 2)}\n`);
  dependencies.stderr.write(`issuer: ${identity.value.issuer}\n`);
  dependencies.stderr.write(`machine ID: ${identity.value.id}\n`);

  return 0;
}

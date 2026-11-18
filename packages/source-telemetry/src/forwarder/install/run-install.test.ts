import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { runInstall } from './run-install.ts';

async function setupTest() {
  const home = await mkdtemp(join(tmpdir(), 'pepys-install-'));

  onTestFinished(async () => {
    await rm(home, { recursive: true, force: true });
  });

  const binPath = join(home, 'forwarder-bin.ts');

  await Bun.write(binPath, '');

  const unitPath = join(home, '.config/systemd/user/pepys-telemetry-forwarder.service');

  return {
    home,
    unitPath,
    flags: ['--issuer', 'study-pc', '--audience', 'forwarder.pepys.example'],
    readMode: async (path: string) => {
      const stats = await stat(path);

      return stats.mode & 0o777;
    },
    readJSON: async (path: string) => {
      const text = await readFile(path, 'utf8');

      const parsed: unknown = JSON.parse(text);

      return parsed;
    },
    probeFile: (path: string) => Bun.file(path).exists(),
    readBin: () => realpath(binPath),
    readMachineID: async () => {
      const text = await readFile(
        join(home, '.config/pepys-telemetry-forwarder/machine.json'),
        'utf8',
      );

      const machine = z.record(z.string(), z.string()).parse(JSON.parse(text));

      return machine['id'] ?? 'missing';
    },
    readKeyScalar: async () => {
      const text = await readFile(
        join(home, '.config/pepys-telemetry-forwarder/private-key.json'),
        'utf8',
      );

      const key = z.record(z.string(), z.string()).parse(JSON.parse(text));

      return key['d'] ?? 'missing';
    },
    install: async (argv: string[], environment: Record<string, string> = {}, bin = binPath) => {
      const out: string[] = [];
      const err: string[] = [];

      const exitCode = await runInstall({
        argv,
        environment,
        home,
        binPath: bin,
        bunPath: '/opt/bun/bin/bun',
        stdout: { write: (text) => out.push(text) },
        stderr: { write: (text) => err.push(text) },
      });

      return { exitCode, stdout: out.join(''), stderr: err.join('') };
    },
    readUnit: () => readFile(unitPath, 'utf8'),
  };
}

test('it prints only the trust document on stdout, and the issuer and the machine ID on stderr', async () => {
  const ctx = await setupTest();
  const result = await ctx.install(ctx.flags);

  const document: unknown = JSON.parse(result.stdout);

  const machineID = await ctx.readMachineID();

  expect({ exitCode: result.exitCode, document, stderr: result.stderr }).toStrictEqual({
    exitCode: 0,
    document: {
      issuer: 'study-pc',
      keys: [
        {
          kty: 'EC',
          crv: 'P-256',
          x: expect.any(String),
          y: expect.any(String),
          kid: expect.any(String),
          alg: 'ES256',
          use: 'sig',
        },
      ],
      retire: [],
    },
    stderr: `issuer: study-pc\nmachine ID: ${machineID}\n`,
  });
});

test('it never prints the private key', async () => {
  const ctx = await setupTest();
  const result = await ctx.install(ctx.flags);
  const scalar = await ctx.readKeyScalar();

  expect(result.stdout + result.stderr).not.toContain(scalar);
});

test('it writes the unit with the bun and the bin file, and sets no ingest URL without a flag', async () => {
  const ctx = await setupTest();

  await ctx.install(ctx.flags);

  const unit = await ctx.readUnit();
  const bin = await ctx.readBin();

  expect(unit).toContain(`ExecStart=/opt/bun/bin/bun ${bin} run`);
  expect(unit).not.toContain('INGEST_URL');
});

test('it writes the ingest URL, and copies the four settings of its own environment, into the unit', async () => {
  const ctx = await setupTest();

  await ctx.install([...ctx.flags, '--ingest-url', 'https://ingest.tailnet.example'], {
    PEPYS_FORWARDER_PORT: '4999',
    PEPYS_FORWARDER_HOST: '127.0.0.2',
    PEPYS_FORWARDER_SPOOL_DIR: join(ctx.home, 'spool'),
    PEPYS_FORWARDER_IDENTITY_DIR: join(ctx.home, 'identity'),
    PEPYS_FORWARDER_ISSUER: 'ignored',
  });

  const unit = await ctx.readUnit();

  const settings = unit.split('\n').filter((line) => line.startsWith('Environment='));

  expect(settings).toStrictEqual([
    'Environment=PEPYS_FORWARDER_HOST=127.0.0.2',
    'Environment=PEPYS_FORWARDER_PORT=4999',
    `Environment=PEPYS_FORWARDER_SPOOL_DIR=${join(ctx.home, 'spool')}`,
    `Environment=PEPYS_FORWARDER_IDENTITY_DIR=${join(ctx.home, 'identity')}`,
    'Environment=PEPYS_FORWARDER_ISSUER=study-pc',
    'Environment=PEPYS_FORWARDER_AUDIENCE=forwarder.pepys.example',
    'Environment=PEPYS_FORWARDER_INGEST_URL=https://ingest.tailnet.example',
  ]);
});

test('it makes the identity in the folder of PEPYS_FORWARDER_IDENTITY_DIR', async () => {
  const ctx = await setupTest();

  const identityDir = join(ctx.home, 'identity');

  await ctx.install(ctx.flags, { PEPYS_FORWARDER_IDENTITY_DIR: identityDir });

  const mode = await ctx.readMode(join(identityDir, 'private-key.json'));

  expect(mode).toBe(0o600);
});

test('it prints the same trust document on a second run, and writes the unit again', async () => {
  const ctx = await setupTest();
  const first = await ctx.install(ctx.flags);

  await Bun.write(ctx.unitPath, 'changed');

  const second = await ctx.install(ctx.flags);
  const unit = await ctx.readUnit();

  expect({
    same: second.stdout === first.stdout,
    exitCode: second.exitCode,
    unitRewritten: unit.startsWith('[Service]'),
  }).toStrictEqual({ same: true, exitCode: 0, unitRewritten: true });
});

test('it exits 1 when --issuer differs from the stored name, and writes no unit', async () => {
  const ctx = await setupTest();

  await ctx.install(ctx.flags);

  await rm(ctx.unitPath);

  const result = await ctx.install(['--issuer', 'office-pc', '--audience', 'a']);

  expect({
    exitCode: result.exitCode,
    stdout: result.stdout,
    unit: await Bun.file(ctx.unitPath).exists(),
  }).toStrictEqual({ exitCode: 1, stdout: '', unit: false });
});

test('it exits 1 for a bad flag and writes nothing', async () => {
  const ctx = await setupTest();
  const result = await ctx.install(['--issuer', 'bad name', '--audience', 'a']);

  expect({ exitCode: result.exitCode, unit: await Bun.file(ctx.unitPath).exists() }).toStrictEqual({
    exitCode: 1,
    unit: false,
  });
});

test('it exits 1 for a bin file in a bunx cache folder', async () => {
  const ctx = await setupTest();

  const cached = join(ctx.home, 'bunx-1000-x', 'forwarder-bin.ts');

  await Bun.write(cached, '');

  const result = await ctx.install(ctx.flags, {}, cached);

  expect({ exitCode: result.exitCode, unit: await Bun.file(ctx.unitPath).exists() }).toStrictEqual({
    exitCode: 1,
    unit: false,
  });
});

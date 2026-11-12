import type { VersionHash } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import type { BuiltModule } from './build-consumer-build-manifest.ts';

// A module is named by the sha256 of its bytes, at `<consumer>/<sha256>.wasm` in the out folder.
export function buildBuiltModule(name: string, bytes: Uint8Array): BuiltModule {
  const module = toTagged<VersionHash>(new Bun.CryptoHasher('sha256').update(bytes).digest('hex'));

  return { name, module, path: `${name}/${module}.wasm` };
}

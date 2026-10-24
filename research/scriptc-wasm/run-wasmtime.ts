import { runCommand } from './run-command.ts';
import type { CommandResult } from './run-command.ts';
import type { SpikeTools } from './types.ts';

// wasmtime caches compiled code under the home directory by default, so each run turns the cache
// off.
const isolation = [
  '-C',
  'cache=n',
  '-S',
  'inherit-env=n',
  '-S',
  'inherit-network=n',
  '-S',
  'tcp=n',
  '-S',
  'udp=n',
  '-S',
  'allow-ip-name-lookup=n',
];

export function runWasmtime(
  tools: SpikeTools,
  args: string[],
  stdin?: string | Uint8Array,
): CommandResult {
  const options = stdin === undefined ? {} : { stdin };

  return runCommand([tools.wasmtime, 'run', ...isolation, ...args], options);
}

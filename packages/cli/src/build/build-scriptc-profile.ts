import type { ConsumerDeclaration } from '@pepys/kit';
import { toPascalCase } from '@pepys/kit/generators';
import { buildModuleSymbols } from './build-module-symbols.ts';
import { consumerFences } from './consumer-fences.ts';

interface ScriptcProfileParameters {
  consumer: ConsumerDeclaration;

  // scriptc reads the entry relative to the folder of the profile file
  entry: string;
}

// The scriptc library profile of one consumer: the entry, the symbols of its exports and of the
// host functions it imports, and the determinism fences.
export function buildScriptcProfile(parameters: ScriptcProfileParameters): object {
  const name = parameters.consumer.name;
  const prefix = `${name}_`;
  const pascalName = toPascalCase(name);
  const symbols = buildModuleSymbols(parameters.consumer);

  const callbacks = symbols.imports.flatMap((read) => [
    { name: read.length, params: ['string'], returns: 'f64' },
    { name: read.into, params: ['string', 'bytes'], returns: 'void' },
  ]);

  return {
    profile_format: 1,
    name,
    entry: parameters.entry,
    emission: 'llvm',
    abi: {
      prefix,
      init_symbol: symbols.exports.init,
      sink_register_symbol: `${prefix}sink`,

      // scriptc refuses a register symbol with no callbacks to register (SC4001)
      ...(callbacks.length === 0 ? {} : { callback_register_symbol: `${prefix}callback` }),
    },
    callbacks,
    exports: [
      {
        export: symbols.entryExport,
        symbol: symbols.exports.apply,
        params: ['string'],
        returns: 'string',
      },
    ],
    sidecar: {
      wire_version: 1,
      abi_version: 1,
      snapshot_format: 1,
      build_id_symbol: `${prefix}build_id`,
      abi_version_symbol: `${prefix}abi_version`,
      model: `${pascalName}Model`,

      // scriptc names the sidecar's message type field msg
      // oxlint-disable-next-line zgeoff/no-abbreviated-names
      msg: `${pascalName}Message`,
    },
    determinism: { fences: consumerFences },
  };
}

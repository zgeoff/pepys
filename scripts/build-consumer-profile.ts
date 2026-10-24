import { toPascalCase } from '@pepys/schema';
import type { ConsumerDeclaration } from '@pepys/schema';
import { consumerFences } from './consumer-fences.ts';

interface ConsumerProfileParameters {
  consumer: ConsumerDeclaration;
  entry: string;
}

export function buildConsumerProfile(parameters: ConsumerProfileParameters): object {
  const name = parameters.consumer.name;
  const prefix = `${name}_`;
  const pascalName = toPascalCase(name);

  return {
    profile_format: 1,
    name,
    entry: parameters.entry,
    emission: 'llvm',
    abi: {
      prefix,
      init_symbol: `${prefix}init`,
      sink_register_symbol: `${prefix}sink`,
      callback_register_symbol: `${prefix}callback`,
    },
    callbacks: parameters.consumer.reads.flatMap((table) => [
      { name: `read${toPascalCase(table)}Length`, params: ['string'], returns: 'f64' },
      { name: `read${toPascalCase(table)}Into`, params: ['string', 'bytes'], returns: 'void' },
    ]),
    exports: [
      {
        export: 'applyFact',
        symbol: `${prefix}apply_fact`,
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

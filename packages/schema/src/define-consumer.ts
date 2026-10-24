import type { ConsumerDeclaration, EntityViewDeclaration, TableDeclaration } from './types.ts';

export function defineConsumer<const Tables extends Readonly<Record<string, TableDeclaration>>>(
  consumer: Omit<ConsumerDeclaration<Tables>, 'entityView'> & {
    readonly entityView?: EntityViewDeclaration<NoInfer<keyof Tables & string>> | undefined;
  },
): ConsumerDeclaration<Tables> {
  return consumer;
}

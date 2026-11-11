import type { LinkTypeDeclaration } from '../link-types/types.ts';
import type { TableDeclaration } from '../types.ts';
import type { ConsumerDeclaration, EntityViewDeclaration } from './types.ts';

type ConsumerInputOf<
  Name extends string,
  Tables extends Readonly<Record<string, TableDeclaration>>,
  LinkType extends LinkTypeDeclaration,
> = Omit<ConsumerDeclaration<Name, Tables, LinkType>, 'entityViews' | 'reads'> & {
  readonly entityViews: readonly EntityViewDeclaration<NoInfer<keyof Tables & string>>[];
  readonly reads: readonly NoInfer<keyof Tables & string>[];
};

export function defineConsumer<
  const Name extends string,
  const Tables extends Readonly<Record<string, TableDeclaration>>,
  const LinkType extends LinkTypeDeclaration = never,
>(consumer: ConsumerInputOf<Name, Tables, LinkType>): ConsumerDeclaration<Name, Tables, LinkType> {
  return consumer;
}

import type { ConsumerDeclaration } from '@pepys/schema';
import type { StoreReader } from '../store-reader/store-reader.ts';

export interface QueryContext {
  store: StoreReader;
  consumers: readonly ConsumerDeclaration[];
}

export interface QueryFailure {
  code: 'NOT_FOUND';
  message: string;
}

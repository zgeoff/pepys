import type { ConsumerDeclaration } from '@pepys/kit';
import type { StoreReader } from '../store-reader/store-reader.ts';

export interface QueryContext {
  store: StoreReader;
  consumers: readonly ConsumerDeclaration[];
}

export interface QueryFailure {
  code: 'NOT_FOUND';
  message: string;
}

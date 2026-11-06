import type { ClientID, GrantID } from '@pepys/schema';

export type Scope = 'read' | 'write';

export interface Principal {
  client: ClientID;
  clientName: string;
  grant: GrantID;
  scopes: readonly Scope[];
}

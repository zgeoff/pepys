import type { ClientID, GrantID } from '@pepys/kit';

export type Scope = 'read' | 'write';

export interface Principal {
  client: ClientID;
  clientName: string;
  grant: GrantID;
  scopes: readonly Scope[];
}

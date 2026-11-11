import type { Row, WireLink } from '../utils/types.ts';

// One operation of a module's output. `inexact` names the columns whose number the module wrote
// with a fraction or an exponent.
export type Operation =
  | { verb: 'upsert'; table: string; row: Row; inexact: ReadonlySet<string> }
  | { verb: 'delete'; table: string; key: Row; inexact: ReadonlySet<string> }
  | { verb: 'link'; link: WireLink }
  | { verb: 'unlink'; link: Pick<WireLink, 'type' | 'from' | 'to'> };

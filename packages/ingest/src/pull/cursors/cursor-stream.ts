import type { StreamName } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';

// The one stream that belongs to no fact family. Its name has two parts, where a family's stream
// has three, so no family and no consumer can name it.
export const cursorStream = toTagged<StreamName>('facts.cursors');

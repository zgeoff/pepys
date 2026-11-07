import type { StreamName } from '@pepys/schema';
import { toTagged } from '@zgeoff/std';

export const pullRequestStream = toTagged<StreamName>('facts.github.pull_request');

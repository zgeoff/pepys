import { assign, fromPromise, setup } from 'xstate';

type StartReason = 'signal' | 'part-ended';

export type StartEvent = { type: 'signal' } | { type: 'part-ended' };

interface StartContext {
  // stops every part, and says whether each one stopped cleanly
  stopParts: () => Promise<boolean>;
  reason: StartReason | null;
  isClean: boolean;
}

interface StartInput {
  stopParts: () => Promise<boolean>;
}

const types: {
  context: StartContext;
  events: StartEvent;
  input: StartInput;
  output: 0 | 1;
} = {
  context: { stopParts: () => Promise.resolve(true), reason: null, isClean: false },
  events: { type: 'signal' },
  input: { stopParts: () => Promise.resolve(true) },
  output: 0,
};

// The supervisor of `pepys start`. It runs until a stop signal or until one part ends, then stops
// every part. It exits 0 only after a stop signal with every part stopped cleanly. A part that
// ends on its own is a failure, whatever its exit code.
export const startMachine = setup({
  types,
  actors: {
    stopParts: fromPromise<boolean, StartInput>((args) => args.input.stopParts()),
  },
  actions: {
    keepSignal: assign({ reason: () => 'signal' as const }),
    keepPartEnded: assign({ reason: () => 'part-ended' as const }),
    keepUnclean: assign({ isClean: () => false }),
  },
}).createMachine({
  context: (args) => ({ stopParts: args.input.stopParts, reason: null, isClean: false }),
  initial: 'running',
  states: {
    running: {
      on: {
        signal: { target: 'stopping', actions: 'keepSignal' },
        'part-ended': { target: 'stopping', actions: 'keepPartEnded' },
      },
    },
    stopping: {
      invoke: {
        // xstate names this key
        // oxlint-disable-next-line zgeoff/no-abbreviated-names
        src: 'stopParts',
        input: (args) => ({ stopParts: args.context.stopParts }),
        onDone: {
          target: 'stopped',
          actions: assign({ isClean: (args) => args.event.output }),
        },
        onError: { target: 'stopped', actions: 'keepUnclean' },
      },
    },
    stopped: { type: 'final' },
  },
  output: (args) => (args.context.reason === 'signal' && args.context.isClean ? 0 : 1),
});

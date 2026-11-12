import { assign, setup } from 'xstate';

interface StoreFileContext {
  readers: number;
}

type StoreFileEvent =
  | { type: 'hold' }
  | { type: 'release' }
  | { type: 'retire' }
  | { type: 'close' };

const types: { context: StoreFileContext; events: StoreFileEvent } = {
  context: { readers: 0 },
  events: { type: 'close' },
};

// The lifecycle of one open store file. The current version is open; the host's swap, or a failed
// open, retires it; a retired file with no readers left is idle, and the store reader closes it.
// A close reaches every state, so closing the store reader ends files that calls still read.
export const storeFileMachine = setup({
  types,
  guards: {
    hasReaders: (args) => args.context.readers > 0,
    isLastReader: (args) => args.context.readers === 1,
  },
  actions: {
    addReader: assign({ readers: (args) => args.context.readers + 1 }),
    removeReader: assign({ readers: (args) => args.context.readers - 1 }),
  },
}).createMachine({
  context: { readers: 0 },
  initial: 'open',
  states: {
    open: {
      on: {
        hold: { actions: 'addReader' },
        release: { guard: 'hasReaders', actions: 'removeReader' },
        retire: [{ guard: 'hasReaders', target: 'retiredWithReaders' }, { target: 'retiredIdle' }],
        close: 'closed',
      },
    },
    retiredWithReaders: {
      on: {
        release: [
          { guard: 'isLastReader', target: 'retiredIdle', actions: 'removeReader' },
          { actions: 'removeReader' },
        ],
        close: 'closed',
      },
    },
    retiredIdle: {
      on: { close: 'closed' },
    },

    // not final: a call that ends after the store reader closed still sends its release
    closed: {},
  },
});

import { assign, setup } from 'xstate';

interface HostProcessContext {
  spawnHost: () => Bun.Subprocess;
  child: Bun.Subprocess | null;
  starts: number;
  lastExitCode: number | null;
}

type HostProcessEvent = { type: 'start' } | { type: 'stop' } | { type: 'exited'; exitCode: number };

interface HostProcessInput {
  spawnHost: () => Bun.Subprocess;
}

// xstate reads only the types of these values
const types: {
  context: HostProcessContext;
  events: HostProcessEvent;
  input: HostProcessInput;
} = {
  context: { spawnHost: failSpawn, child: null, starts: 0, lastExitCode: null },
  events: { type: 'start' },
  input: { spawnHost: failSpawn },
};

// One host process at a time: `start` spawns it when none runs, `stop` sends it SIGTERM, and its
// exit, asked for or not, leaves the machine stopped.
export const hostProcessMachine = setup({
  types,
  actions: {
    spawnChild: assign((args) => {
      const child = args.context.spawnHost();

      void watchExit(child, (exitCode) => {
        args.self.send({ type: 'exited', exitCode });
      });

      return { child, starts: args.context.starts + 1 };
    }),
    signalChild: (args) => {
      args.context.child?.kill('SIGTERM');
    },
    forgetChild: assign((args) => ({
      child: null,
      lastExitCode: args.event.type === 'exited' ? args.event.exitCode : null,
    })),
  },
}).createMachine({
  id: 'hostProcess',
  context: (args) => ({
    spawnHost: args.input.spawnHost,
    child: null,
    starts: 0,
    lastExitCode: null,
  }),
  initial: 'stopped',
  states: {
    stopped: {
      on: { start: { target: 'running', actions: 'spawnChild' } },
    },
    running: {
      on: {
        stop: { target: 'stopping', actions: 'signalChild' },
        exited: { target: 'stopped', actions: 'forgetChild' },
      },
    },
    stopping: {
      on: { exited: { target: 'stopped', actions: 'forgetChild' } },
    },
  },
});

function failSpawn(): never {
  throw new Error('the machine spawns with the spawnHost of its input');
}

async function watchExit(child: Bun.Subprocess, onExit: (exitCode: number) => void): Promise<void> {
  const exitCode = await child.exited;

  onExit(exitCode);
}

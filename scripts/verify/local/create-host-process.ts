import { createActor, waitFor } from 'xstate';
import { hostProcessMachine } from './host-process-machine.ts';

export interface HostProcess {
  state: () => 'running' | 'stopped';

  // how many times the host has started in this run
  starts: () => number;
  start: () => void;

  // the host's exit code, or null when it was not running
  stop: () => Promise<number | null>;
}

// Runs the host as a child of this process, so a stop and a start leave ingest and the API
// running. `spawnHost` starts one host process.
export function createHostProcess(spawnHost: () => Bun.Subprocess): HostProcess {
  const actor = createActor(hostProcessMachine, { input: { spawnHost } }).start();

  return {
    state: () => (actor.getSnapshot().matches('running') ? 'running' : 'stopped'),
    starts: () => actor.getSnapshot().context.starts,
    start: () => {
      actor.send({ type: 'start' });
    },
    stop: async () => {
      const wasRunning = actor.getSnapshot().matches('running');

      actor.send({ type: 'stop' });

      const stopped = await waitFor(actor, (snapshot) => snapshot.matches('stopped'), {
        timeout: Infinity,
      });

      return wasRunning ? stopped.context.lastExitCode : null;
    },
  };
}

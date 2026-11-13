import invariant from 'tiny-invariant';
import type { Clock } from '../system-clock.ts';

interface StubTimer {
  readonly dueAt: number;
  readonly callback: () => void;
}

export function buildStubClock() {
  let time: number | null = null;
  let nextID = 0;

  const getTime = (): number => {
    invariant(time !== null, "set the stub clock's time in the test before the code reads it");

    return time;
  };

  const timers = new Map<number, StubTimer>();

  const delays: number[] = [];

  const findDue = (until: number): [number, StubTimer] | null => {
    let due: [number, StubTimer] | null = null;

    for (const entry of timers) {
      if (entry[1].dueAt <= until && (due === null || entry[1].dueAt < due[1].dueAt)) {
        due = entry;
      }
    }

    return due;
  };

  const clock: Clock = {
    now: getTime,
    schedule: (callback, delayMs) => {
      const id = nextID++;

      delays.push(delayMs);
      timers.set(id, { dueAt: getTime() + Math.max(0, delayMs), callback });

      return () => {
        timers.delete(id);
      };
    },
  };

  return {
    ...clock,
    setTime(timeMs: number): void {
      invariant(time === null, "the stub clock's time is set already, so advance it instead");

      time = timeMs;
    },
    advance(durationMs: number): void {
      const until = getTime() + durationMs;

      for (let due = findDue(until); due !== null; due = findDue(until)) {
        timers.delete(due[0]);

        time = due[1].dueAt;

        due[1].callback();
      }

      time = until;
    },
    collectPending: (): number[] => {
      const now = getTime();

      return [...timers.values()]
        .map((timer) => timer.dueAt - now)
        .toSorted((left, right) => left - right);
    },
    collectDelays: (): number[] => [...delays],
  };
}

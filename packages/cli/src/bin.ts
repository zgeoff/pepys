#!/usr/bin/env bun
import { runCLI } from './run-cli.ts';

// Exit at once: a startup request that `pepys start` stopped waiting for, such as one to an S2
// endpoint that never answers, would otherwise keep the event loop, and the process, alive.
const exitCode = await runCLI(process.argv.slice(2));

process.exit(exitCode);

#!/usr/bin/env bun
import { runCLI } from './run-cli.ts';

process.exitCode = await runCLI(process.argv.slice(2));

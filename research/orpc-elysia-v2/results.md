# ORPC on Elysia v2: results

The spike has not run. This file holds its method and the check it must pass, and the
[README](README.md) holds the question.

## Method

1. Create a Bun app on the Elysia v2 release candidate.
2. Mount one oRPC route with a zod input through the adapter of oRPC v1, then of oRPC v2.
3. Call the route from the oRPC client and check the typed result.
4. Mount an MCP server beside it on the same app.

The spike passes when one combination of versions serves the typed route and the MCP endpoint from
one Elysia v2 app.

## Setup

The spike has no runner yet, and its `package.json` pins no version.

## Untested

Every step of the method, until the spike runs.

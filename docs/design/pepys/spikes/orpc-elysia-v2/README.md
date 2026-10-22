# Spike: oRPC on Elysia v2

The API runs Elysia v2 with oRPC for typed routes. Elysia v2 is at release candidate and oRPC v2 is
in beta, and the API cannot be built until the two are known to work together.

## Question

Does oRPC's Elysia adapter work with Elysia v2, and does it need oRPC v1 or v2?

## Method

1. Create a Bun app on the Elysia v2 release candidate.
2. Mount one oRPC route with a zod input through the adapter of oRPC v1, then of oRPC v2.
3. Call the route from the oRPC client and check the typed result.
4. Mount an MCP server beside it on the same app.

## Passes when

One combination of versions serves the typed route and the MCP endpoint from one Elysia v2 app.

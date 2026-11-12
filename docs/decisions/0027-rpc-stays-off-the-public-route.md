# 0027: Only MCP and the OAuth paths are public, and /rpc stays off the internet

Date: 2026-11-12

## Decision

pepys's API serves two kinds of endpoint:

- MCP, for agents such as Claude Code, at `/mcp`. It also answers MCP at `POST /`, for a client that
  posts to the origin with no path.
- Typed oRPC queries, for scripts, under `/rpc`.

The public route is the way in from the internet: a Cloudflare tunnel that the owner's other servers
share, so pepys runs no tunnel of its own. The public route carries only MCP and the OAuth paths,
the sign-in pages included, that [the OAuth server](./0025-own-oauth-server-with-passkey.md) needs.
It never carries `/rpc`.

The API binds one listener, and `/rpc` on it takes no credential. Only the tunnel's list of paths
keeps `/rpc` off the internet, so leave the API's port unexposed in any other way until the work
below is built.

`/rpc` then moves to a second listener, the tailnet listener, which the owner's PC reaches over the
owner's Tailscale network, the tailnet. Each request carries a service token, a long random string
whose SHA-256 digest the API finds in its callers file.
[Auth for the API](../design/api-auth/README.md#later-work-service-tokens-and-more-listeners) holds
that design: where the callers file lives, the Kubernetes NodePort that carries the listener, and
the client address check that limits it to the tailnet.

## Rejected alternatives

| Option                                                                    | Why not                                                                                 |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `/rpc` on the public route, with OAuth tokens                             | a script on the PC then needs a browser sign-in                                         |
| `/rpc` on the public route, with service tokens                           | a leaked service token then works from anywhere on the internet                         |
| MCP on a public port with its own TLS certificate, in place of the tunnel | MCP answers each request with one short message, so the shared tunnel is enough for MCP |

A certificate would also add renewal and one more open port to keep.

## Why

The owner's agents run on devices and in places that aren't on the tailnet, so MCP has to be public.
The scripts that call `/rpc` run on the owner's PC, which is on the tailnet. Tailscale encrypts the
tailnet and authenticates each device, so `/rpc` needs no public route and no TLS of its own.

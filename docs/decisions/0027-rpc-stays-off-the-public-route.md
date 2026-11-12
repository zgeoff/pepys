# 0027: Only MCP and sign-in are public, and /rpc stays on the tailnet

Date: 2026-11-12

## Decision

pepys's API serves two kinds of endpoint:

- MCP, for agents such as Claude Code, at `/mcp`. It also answers MCP at `POST /`, for a client that
  posts to the origin with no path.
- Typed oRPC queries, for scripts, under `/rpc`.

The public route is the way in from the internet: a Cloudflare tunnel that the owner's other servers
share, so pepys runs no tunnel of its own.

- The public route carries only MCP and the OAuth and sign-in paths that
  [the OAuth server](./0025-own-oauth-server-with-passkey.md) needs.
- `/rpc` is never on the public route. The owner's PC reaches `/rpc` over the owner's Tailscale
  network, the tailnet. Each request carries a service token, a long random string that the API
  checks against a file of digests. The owner's own scripts on the PC read that token from
  1Password.
- A Kubernetes NodePort Service carries `/rpc` to the tailnet. A NodePort answers on every address
  of the node, so the API's tailnet listener admits only client addresses in its list of tailnet
  addresses, and the NodePort keeps the client's address with `externalTrafficPolicy: Local`.

[Auth for the API](../design/api-auth/README.md#later-work-service-tokens-and-more-listeners) holds
the design of the tailnet listener and the service tokens. Until they are built, `/rpc` takes no
credential, and only the tunnel's list of paths keeps it off the public route.

## Rejected alternatives

| Option                                                                    | Why not                                                                                                                                                                                                    |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/rpc` on the public route, with OAuth tokens                             | a script on the PC then needs a browser sign-in                                                                                                                                                            |
| `/rpc` on the public route, with service tokens                           | a leaked service token then works from anywhere on the internet                                                                                                                                            |
| MCP on a public port with its own TLS certificate, in place of the tunnel | a server that holds long event streams open, such as impz, needs its own TLS front; MCP answers each request with one message, so the tunnel carries it, and a certificate adds renewal and a port to keep |

## Why

The owner's agents run on devices and in places that aren't on the tailnet, so MCP has to be public.
The scripts that call `/rpc` run on the owner's PC, which is on the tailnet. Tailscale encrypts the
tailnet and authenticates each device, so `/rpc` needs no public route and no TLS of its own.

# 0027: Only MCP and sign-in are public, and /rpc stays on the tailnet

Date: 2026-11-12

## Decision

pepys's API serves two kinds of route: MCP at `/mcp`, and at `POST /` for a client that drops the
path, for agents such as Claude Code, and typed oRPC routes under `/rpc`, for scripts.

- The public route carries only MCP and the OAuth and sign-in paths that
  [the OAuth server](./0025-own-oauth-server-with-passkey.md) needs. It runs through the Cloudflare
  tunnel that the owner's other servers share.
- `/rpc` is never public. The owner's PC reaches `/rpc` over the owner's Tailscale network, the
  tailnet, with a service token that the owner's script reads from 1Password. A Kubernetes NodePort
  carries the route, and answers on the server's tailnet address only.

## Rejected alternatives

| Option                                                                    | Why not                                                                                                                                          |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/rpc` on the public route, with OAuth tokens                             | a script on the PC then needs a browser sign-in                                                                                                  |
| `/rpc` on the public route, with service tokens                           | a leaked service token then works from anywhere on the internet                                                                                  |
| MCP on a public port with its own TLS certificate, in place of the tunnel | MCP answers each request with one message and holds no long stream open, so the tunnel carries it, and a certificate adds one more thing to keep |

## Why

The owner's agents run on devices and in places that aren't on the tailnet, so MCP has to be public.
The scripts that call `/rpc` run on the owner's PC, which is on the tailnet. Tailscale encrypts the
tailnet and proves each device, so `/rpc` needs no public route and no TLS of its own.

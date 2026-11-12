# 0027: Only MCP and sign-in are public, and /rpc stays on the tailnet

Date: 2026-11-12

## Decision

The public route, through the shared Cloudflare tunnel, carries only `/mcp` and the OAuth and
sign-in paths. `/rpc` is never public. The owner's PC reaches `/rpc` over the owner's tailnet,
through a NodePort that answers on the server's tailnet address only, with a service token from
1Password.

## Rejected alternatives

| Option                                         | Why not                                                                           |
| ---------------------------------------------- | --------------------------------------------------------------------------------- |
| `/rpc` on the public route with OAuth tokens   | a script on the PC then needs a browser sign-in                                   |
| `/rpc` on the public route with service tokens | a leaked service token then works from the internet                               |
| a public route with its own TLS front          | MCP answers each post with JSON and holds no stream open, so the tunnel serves it |

## Why

atc and impz each expose only MCP to the internet. The owner's PC is already on the tailnet, and
WireGuard encrypts the tailnet and proves each peer, so `/rpc` needs no public route and no TLS of
its own.

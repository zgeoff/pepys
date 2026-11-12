# 0026: Each credential works only on the listeners it is bound to

Date: 2026-11-12

## Decision

The API runs three listeners: a public one for MCP and sign-in, one on the owner's tailnet, and one
inside the cluster. Each listener takes one kind of credential. The public listener takes only OAuth
access tokens. The tailnet and cluster listeners take only service tokens, and each service caller
lists the listeners its tokens work on. Every listener needs a credential on every query, whatever
address it binds.

## Rejected alternatives

| Option                                                        | Why not                                                                                                   |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| two listeners, with the tailnet route on the cluster listener | a leaked token of a pod then works from the tailnet, and a leaked token of the owner's PC works from pods |
| service tokens in an environment variable, read once at start | a revocation then restarts the pod, which also stops the host that shares it                              |
| network policies and the tailnet as the only check, as in v1  | a network policy never stops a process on the cluster's node, which reaches every listener                |

## Why

A leaked credential then opens only the route its caller uses. A pod such as the boxxy server can't
sign in with a passkey and doesn't come from the owner's PC, so it gets a listener of its own.
Revoking one caller's token leaves every other caller working.

## Consequences

- Tests and local runs write a callers file and send a token.
- A new kind of caller needs a listener entry in the callers file, and a new kind of route needs a
  new listener.

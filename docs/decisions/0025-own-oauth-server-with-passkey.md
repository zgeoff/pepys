# 0025: The API runs its own OAuth server, and the owner signs in with a passkey

Date: 2026-11-12

## Decision

The API runs its own OAuth 2.1 authorization server for the owner's MCP clients, on better-auth,
with code copied from the OAuth server of atc, the owner's agent control tower. The owner is the one
user, and a passkey is the one credential that signs the owner in. The owner adds each client by
hand, and each authorization needs a fresh passkey sign-in.

## Rejected alternatives

| Option                                                  | Why not                                                                                       |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| an outside identity provider                            | pepys serves one owner, and a provider adds a second system to trust and to keep up           |
| a sign-in code approved with an API token, as impz does | pepys has no such token for the owner                                                         |
| dynamic client registration or client metadata files    | either one lets any client start a sign-in                                                    |
| a package that atc, impz and pepys share, built first   | the API needs auth before its first source of personal data, and the package can follow later |

## Why

A passkey works from each of the owner's devices, and nobody can guess a passkey assertion. A server
copied from atc keeps the rules the two servers share in one known shape, and atc's OAuth doc gives
the reasons behind them.

## Consequences

- Losing every passkey locks the owner out until the owner enrols a new one with an admin command in
  the API's container.

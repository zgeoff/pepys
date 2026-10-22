# 0015: Enrichment runs in TypeScript and calls hosted models

Date: 2026-10-22

## Decision

Enrichment is a TypeScript service on Bun. It runs git through the CLI, parses MIME with an npm
parser, sends typed decisions to Jev, and leaves agent work to Claude over MCP. Every result returns
to the log as a fact. pepys runs no local language model.

## Rejected alternatives

| Option                         | Why not                                                  |
| ------------------------------ | -------------------------------------------------------- |
| enrichment in Rust             | no speed need, and slower iteration on prompts and rules |
| local language models          | the hardware cost is out of reach                        |
| diff hunks from the GitHub API | rate limits, truncated large diffs, and no blame         |

## Why

Enrichment waits on outside systems, so TypeScript costs nothing in speed. Jev's typed choice with a
probability matches labelling and pair judgement exactly. The no-hosted-services rule covers
software products, and model APIs fall outside it.

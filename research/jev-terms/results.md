# Jev terms and choice sets: results

The spike has not run. This file holds its method and the check it must pass, and the
[README](README.md) holds the question.

## Method

1. Read Jev's data and retention terms.
2. Send one labelling call with a fixed label set and one call with a per-call choice set.
3. Record the returned choice, the probability and the latency of each.

The spike passes when the terms allow email content, and the spike states whether link judgement
asks one question per pair or one per candidate set.

## Setup

The spike has no runner yet, and its `package.json` pins no version.

## Untested

Every step of the method, until the spike runs.

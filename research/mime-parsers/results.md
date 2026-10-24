# MIME parsers: results

The spike has not run. This file holds its method and the check it must pass, and the
[README](README.md) holds the question. Real email holds nested parts, odd encodings and HTML-only
bodies, so the method uses real messages.

## Method

1. Export 200 raw messages from the owner's mailbox, including newsletters, receipts, GitHub
   notifications and replies with quoted history.
2. Parse each one with both parsers.
3. Compare the plain text, the attachment list and any errors for each message.

The spike passes when one parser extracts readable text from every message with no crash, and the
spike names it.

## Setup

The spike has no runner yet, and its `package.json` pins no version.

## Untested

Every step of the method, until the spike runs.

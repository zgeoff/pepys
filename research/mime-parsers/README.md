# MIME parsers

The mail text job parses raw MIME messages with an npm parser. Real email holds nested parts, odd
encodings and HTML-only bodies, and the parser decides the text every later mail job reads.

## Question

Which of `postal-mime` and `mailparser` extracts better plain text from the owner's real email under
Bun?

## Method

1. Export 200 raw messages from the owner's mailbox, including newsletters, receipts, GitHub
   notifications and replies with quoted history.
2. Parse each one with both parsers.
3. Compare the plain text, the attachment list and any errors for each message.

## Passes when

One parser extracts readable text from every message with no crash, and the spike names it.

## Run

The spike has no runner yet.

## Result

The spike has not run.

## Untested

Every step of the method, until the spike runs.

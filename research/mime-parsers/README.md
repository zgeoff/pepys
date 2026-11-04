# Spike: MIME parsers

The mail text job parses raw MIME messages with an npm parser, and the parser decides the text every
later mail job reads. This spike compares two parsers on 24 invented raw messages under Bun, for the
enrichment design.

## Question

Which of `postal-mime` and `mailparser` extracts better plain text from the owner's real email under
Bun?

## Answer

- Partial: the spike ran on an invented corpus, and the owner's real mail remains. No parser passes,
  since all lose the body when it uses a boundary other than the one its header declares.
- Of the 23 messages with a body, `postal-mime` 4.1.4 with `html-to-text` 10.0.1 for HTML-only
  messages reads 22. `mailparser` 3.12.4 reads 20, and `postal-mime` alone 19.
- `postal-mime` returns no text for a message with no text part. `mailparser` converts the HTML, but
  not inside `multipart/related`.
- Neither crashes. Both decode every charset tested and list every attachment with the right bytes.
- `postal-mime` parses a small message 3.5 to 4.5 times faster than `mailparser`, at about 0.02 ms
  against 0.08 to 0.1 ms. `mailparser` is about 1.5 times faster on a 5 MiB attachment.

On this invented corpus, use `postal-mime` with `html-to-text` when a message has no text part, and
flag a message that yields no text.

## Run it

```bash
bun run --filter ./research/mime-parsers check
```

The versions, the corpus and the command for a folder of real messages are in
[Setup](results.md#setup).

## Results

[results.md](results.md) holds the text, attachment, header and time results for each message.

## Untested

The owner's real mail and the step to run it, larger messages, more charsets and other options:
[Untested](results.md#untested).

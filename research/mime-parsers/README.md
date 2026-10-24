# Spike: MIME parsers

The mail text job parses raw MIME messages with an npm parser, and the parser decides the text every
later mail job reads. This spike compares two parsers on the owner's real email, for the enrichment
design.

## Question

Which of `postal-mime` and `mailparser` extracts better plain text from the owner's real email under
Bun?

## Answer

- The spike has not run, so it holds no verdict and no numbers.

The enrichment design holds no recommendation from this spike until it runs.

## Results

[results.md](results.md) holds the method and the check the spike must pass.

## Untested

Every step of the method, until the spike runs: [Untested](results.md#untested).

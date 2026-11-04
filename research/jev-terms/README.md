# Spike: Jev terms and choice sets

Enrichment sends email text and candidate pairs to Jev, TypeSafe AI's decision model, for labels and
judgements, so Jev will see the owner's email. This spike reads TypeSafe's data terms and API
reference, for the enrichment design's link judgement.

## Question

What do Jev's data terms allow, and does its API accept a set of choices per call, such as "which of
these five issues, or none"?

## Answer

The spike is partial: it read the sources on 2026-11-04, and the API calls wait on a Jev API key.

- No TypeSafe term forbids email content, and TypeSafe never trains a model on it without the
  customer's consent.
- No term sets a retention period: TypeSafe keeps the content "as long as necessary" for its
  purpose, and offers zero data retention only to enterprise customers.
- TypeSafe may keep telemetry about each call, classifications included, forever and use it without
  restriction.
- The data processing addendum names only the customer and the customer's users as the people whose
  data TypeSafe processes, and email senders are neither.
- Each Choice question carries its own options, from 1 to 255, and one request can hold many
  questions, so one call can judge a candidate set or several pairs.

Send email to Jev only after the owner decides that third-party senders' mail may go to TypeSafe,
and accepts open-ended retention and telemetry.

## Run it

```bash
JEV_API_KEY=<typesafe_api_key> bun run --filter ./research/jev-terms check
```

`<typesafe_api_key>` is a key from the TypeSafe console. The calls and the model are in
[Setup](results.md#setup).

## Results

[results.md](results.md) holds each quoted clause with its URL, and the API facts.

## Untested

Every API call, and which link judgement shape gives better answers:
[Untested](results.md#untested).

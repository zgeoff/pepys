# Spike: Jev terms and choice sets

Enrichment sends email text and candidate pairs to Jev for labels and judgements. Jev will see the
owner's email, and the shape of its API decides how link judgement asks its question.

## Question

What do Jev's data terms allow, and does its API accept a set of choices per call, such as "which of
these five issues, or none"?

## Method

1. Read Jev's data and retention terms.
2. Send one labelling call with a fixed label set and one call with a per-call choice set.
3. Record the returned choice, the probability and the latency of each.

## Passes when

The terms allow email content, and the spike states whether link judgement asks one question per
pair or one per candidate set.

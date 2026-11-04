# Jev terms and choice sets: results

Step 1 read TypeSafe AI's terms and API reference on 2026-11-04. The runner ran steps 2 and 3 on the
same day. The [README](README.md) holds the question.

## Method

1. Read Jev's data and retention terms.
2. Send one labelling call with a fixed label set and one call with a per-call choice set.
3. Record the returned choice, the probability and the latency of each.

The spike passes when the terms allow email content, and the spike states whether link judgement
asks one question per pair or one per candidate set.

The spike passes:

- **Email content: allowed.** No TypeSafe term forbids email as input. The terms make the owner
  answer for the rights of each third-party sender, and the DPA's list of data subjects leaves those
  senders out. [Whether email may be sent](#whether-email-may-be-sent) quotes both clauses. The
  owner accepted sending third-party mail on 2026-11-04.
- **Link judgement shape: one question per pair.** Both shapes gave the same answer, so the choice
  rests on what each shape can say. [API calls](#api-calls) gives the answers and the reason.

## Setup

Jev is the model that [docs.typesafe.ai](https://docs.typesafe.ai/introduction.md) names as
"TypeSafe's flagship model and the first System One model". TypeSafe AI, Inc. is unrelated to the
Scala company Typesafe Inc.

The runner, [run-spike.ts](run-spike.ts), reads the key from `JEV_API_KEY` and calls
`https://api.typesafe.ai`. TypeSafe's own SDKs read `TYPESAFE_API_KEY` instead. The runner:

1. Calls `GET /v1/models` and records the models the account sees.
2. Sends each of three requests from [build-spike-requests.ts](build-spike-requests.ts) 5 times to
   `POST /v1/systemone`, with `model: "jev-1.14.0"`.
3. Prints, as JSON, each response, each latency in milliseconds and the median latency per request.

| Request           | State                               | Questions                                                                         |
| ----------------- | ----------------------------------- | --------------------------------------------------------------------------------- |
| `fixed-label-set` | an invented invoice email           | one Choice over 5 fixed mail labels                                               |
| `candidate-set`   | an invented bug report and 5 issues | one Choice over the 5 issues, and one Noul that asks whether any issue fits       |
| `per-pair`        | the same bug report                 | 5 Choice questions, one per issue, each with `related`, `unrelated` and `unclear` |

The `candidate-set` and `per-pair` requests are the two link judgement shapes. The Noul follows
TypeSafe's [companion Noul pattern](https://docs.typesafe.ai/patterns/companion-noul.md) for "none
of these". Every fixture is invented.

| Package      | Version                           |
| ------------ | --------------------------------- |
| Jev model    | `jev-1.14.0`, released 2026-10-14 |
| `zod`        | 4.6.7                             |
| `@types/bun` | 1.4.4                             |

## Data terms

Every page was read on 2026-11-04. The Master Customer Agreement governs the API; the Terms of Use
cover only the website.

| Document                        | URL                                               | Last updated |
| ------------------------------- | ------------------------------------------------- | ------------ |
| Privacy Policy                  | <https://typesafe.ai/legal/privacy-policy>        | 2025-11-19   |
| Master Customer Agreement (MCA) | <https://typesafe.ai/legal/mca>                   | 2026-09-23   |
| Data Processing Addendum (DPA)  | <https://typesafe.ai/legal/data-processing>       | 2026-04-24   |
| Acceptable Use Policy (AUP)     | <https://typesafe.ai/legal/acceptable-use-policy> | 2026-09-23   |
| Legal index                     | <https://docs.typesafe.ai/legal.md>               | none shown   |

### Whether email may be sent

No clause forbids email or personal data as input. The customer carries the duty to have the right
to send it. MCA section 5:

> "Customer is responsible for Input, including its content and accuracy, and will comply with Laws
> when using the Services. Customer represents, warrants, and covenants that it has made all
> disclosures, has provided all notices, and has obtained (and will maintain) all rights, consents,
> and permissions necessary for TypeSafe to exercise the rights granted to it in this Agreement
> (including the rights granted with respect to Input) without violating or infringing Laws or
> third-party rights."

The DPA, Schedule I, lists whose data TypeSafe processes. An email's sender is a third party,
outside this list:

> "2. Categories of Data Subjects Customer and Customer's users."

The AUP, section 1, starts "You may not use the Services to:". Three of its clauses bear on email:

> "1.1 infringe, misappropriate, or violate another person's intellectual property, privacy,
> publicity (e.g., voice or likeness), or other rights, whether that person is living or dead;"

> "1.2 upload, process, store, or attempt to create any illegal content;"

> "1.5 upload, store, post, or transmit content, including Input, that contains viruses, malware,
> malicious code, or similar harmful materials;"

Clause 1.5 matters for a raw message with an attachment. The mail text job sends the extracted plain
text, not the raw MIME message.

### Training

The Privacy Policy and the MCA both rule out training on input. Privacy Policy, "How We Use the
Personal Data We Collect":

> "We (1) will not train or fine tune any artificial intelligence or machine learning models on
> Input, and (2) will not disclose any Input to a third party other than our service providers."

MCA section 4.1:

> "The foregoing license does not grant TypeSafe the right to, and TypeSafe will not, include
> Customer Data in a dataset used to train (i.e., to modify the model weights of) any artificial
> intelligence or machine learning models without Customer's prior consent."

MCA section 4.1 defines Customer Data as the Input and the Output together.

### Retention

No document gives a retention period in days. The terms bound retention by purpose instead. DPA
section 2.2:

> "Typesafe will not … (b) retain, use, or disclose Customer Personal Data for any purpose other
> than in accordance with the Documented Instructions, (c) retain, use, or disclose Customer
> Personal Data outside of the direct business relationship between Customer and Typesafe"

Privacy Policy, "Retention":

> "We retain personal data about you for as long as reasonably necessary to provide you with the
> Services, or otherwise in support of our business or commercial purposes."

DPA, Schedule I, item 8:

> "Customer Personal Data will be retained for as long as necessary taking into account the purpose
> of the Processing, and in compliance with applicable laws, including laws on the statute of
> limitations and Data Protection Law."

MCA section 10.3:

> "TypeSafe will be under no obligation to store or retain Customer Data and may delete Customer
> Data at any time in its sole discretion. Customer Confidential Information may be retained in
> TypeSafe's standard backups notwithstanding any obligation to delete the applicable Confidential
> Information but will remain subject to this Agreement's confidentiality restrictions."

The legal index offers zero data retention only on request, and only to enterprise customers:

> "We also offer zero data retention (ZDR) for enterprise customers. To learn more, fill out the
> [support request form](https://support.typesafe.ai/forms/support-request)."

### Telemetry

MCA section 4.1 licenses Customer Data "in perpetuity" for three uses:

> "(c) in perpetuity, any Customer Data (i) to derive and generate Telemetry, (ii) to monitor for
> fraud and abuse of the Services, and (iii) as necessary to comply with applicable Laws."

MCA section 4.3 sets no limit on telemetry. A mail label is a classification, so this clause covers
what Jev derives from the owner's email:

> "'Telemetry' means information generated in connection with the Services, such as technical logs,
> hashes, summary statistics and classifications, metrics, and learnings related to Customer's use
> of the Services. TypeSafe may Process Telemetry without restriction, including to improve the
> Services or TypeSafe's other products and services."

### Location and sub-processors

The Privacy Policy, "International Visitors", says "The Services are hosted in the United States".
DPA section 3.1 names the sub-processors at <https://trust.typesafe.ai/subprocessors>. That page
loads its list with JavaScript, and a plain fetch returned only the page frame, so the spike holds
no sub-processor list. MCA section 4.4 links the DPA at `https://typesafe.ai/data-processing`; the
live DPA is at `/legal/data-processing`.

## API facts

These come from the [API reference](https://docs.typesafe.ai/api/system-one.md), its
[OpenAPI document](https://api.typesafe.ai/openapi.json) (version 0.2.0), the
[Choice page](https://docs.typesafe.ai/primitives/choice.md) and the
[Models page](https://docs.typesafe.ai/models.md), read on 2026-11-04.

**A per-call choice set: yes.** Each request carries its questions, and each Choice question carries
its options in `criteria`. In the OpenAPI document, `ChoiceQuestion` requires `type` and `criteria`,
and `criteria` has `minProperties: 1` and `maxProperties: 255`. No endpoint registers a label set
ahead of time. The Choice page:

> "`criteria`: The answer options, as a map. Each key is an option name and each value is a
> description of that option."

> "A Choice question accepts up to 255 options, and adding options costs a few tokens each, so give
> the model the full list of teams, categories, or products rather than a shortlist. Add an `other`
> or `none of the above` option when the list might not cover every input, so the model can say none
> of the others fit."

The same page advises a Noul beside the Choice in place of a "none" option:

> "A `none of the above` option may not work well in many use cases. As an alternative, ask a
> companion Noul question in the same request that checks whether anything fits at all"

**Many questions per call: yes.** `questions` is a map from names the caller picks to questions,
with `minProperties: 1`. The Models page:

> "There is no separate limit on the number of questions in a request. Any number of questions is
> allowed as long as the request fits both limits."

| Fact           | Value                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------- |
| Endpoint       | `POST https://api.typesafe.ai/v1/systemone`, with `Authorization: Bearer <API_KEY>`                         |
| Request fields | `model`, `state` and `questions`, all required; `assets` for images                                         |
| Choice answer  | `choice`, `confidence` from 0 to 1, and `probabilities` keyed by option name                                |
| Noul answer    | `noul`, the probability of yes                                                                              |
| Context        | 64k tokens per request and 32k per question; 262k with the `TypeSafe-Danger-Zone-Long-Context: true` header |
| Body size      | 32 MiB at most                                                                                              |
| Price          | $0.042 per million input tokens; output tokens are free                                                     |
| Current models | `jev-1.14.0` and `jev-1.13.0`                                                                               |

The Choice `confidence` measures how the probabilities spread, not whether the answer is right. The
[Choice page](https://docs.typesafe.ai/primitives/choice.md) says it is "computed from how
`probabilities` is spread".

## API calls

The runner ran on 2026-11-04. Each request ran 5 times, and every response named `jev-1.14.0`. The
API accepted all three requests.

| Request           | Answer, the same in all 5 runs                               | Confidence | Input tokens | Median latency |
| ----------------- | ------------------------------------------------------------ | ---------- | ------------ | -------------- |
| `fixed-label-set` | `invoice`                                                    | 1          | 458          | 197 ms         |
| `candidate-set`   | `issue_57`; the companion Noul gave 0.99 that any issue fits | 1          | 586          | 199 ms         |
| `per-pair`        | `issue_57` `related`, and the other 4 issues `unrelated`     | 0.98 to 1  | 803          | 200 ms         |

Every latency fell between 194 ms and 213 ms. The two link judgement shapes agree on the fixture.
The `per-pair` shape costs 217 more input tokens, which is $0.000009 a call at the listed price.

Link judgement asks one question per pair. Its answer can mark more than one candidate as related,
and can mark a pair `unclear`. The candidate-set shape names one winner at most, so a bug report
that fits two issues loses one link.

`GET /v1/models` listed only `jev-latest` and `jev-preview`, while the
[Models page](https://docs.typesafe.ai/models.md) lists `jev-1.14.0` and `jev-1.13.0`. The API still
accepted the pinned `jev-1.14.0`.

## Untested

- Which shape judges better on real mail: the fixture is one invented bug report, and both shapes
  agree on it.
- How long a pinned version such as `jev-1.14.0` stays callable, since the models listing leaves it
  out.
- Whether the options' order changes the answer.
- TypeSafe's sub-processors, since their page did not load without JavaScript.
- Whether an individual can sign the MCA and get zero data retention, since the legal index offers
  it to "enterprise customers" only.
- Whether a legal reading of MCA section 5 and DPA Schedule I lets the owner send mail from third
  parties. The spike quotes the clauses and holds no legal opinion.

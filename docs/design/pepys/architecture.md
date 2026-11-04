# Architecture

Write each pepys contract by the rules in this doc, so that two agents who implement it from its
type alone build the same behaviour. A contract is a type or a command signature that one part of
pepys declares and another part builds against. The [pepys design](./README.md) defines the parts:
the log, ingest, the host, consumers, the store, enrichment and the API.

| Rule                                                | Applies to                                                        |
| --------------------------------------------------- | ----------------------------------------------------------------- |
| [ports and adapters](#ports-and-adapters)           | every call from pepys to an outside system, and every API entry   |
| [strategies](#strategies)                           | a processing step with competing implementations                  |
| [champion and challenger](#champion-and-challenger) | every new version of a consumer, an enrichment job or the ranking |
| [buckets](#buckets)                                 | an enrichment challenger only                                     |
| [provisional contracts](#provisional-contracts)     | a contract that depends on a spike that has not run               |

## Ports and adapters

pepys calls each outside system through a port: a typed contract that declares what pepys needs from
that system. An adapter implements the port for one system. pepys calls a driven port. A caller
outside pepys calls a driving port.

| Port                         | Side    | Adapters                                                      |
| ---------------------------- | ------- | ------------------------------------------------------------- |
| fact log: append, read, tail | driven  | s2-lite, the Parquet lake for a rebuild, an in-memory log     |
| blob store                   | driven  | Garage, a local folder                                        |
| source client                | driven  | the GitHub App, Gmail, recorded fixtures                      |
| model provider               | driven  | the Jev API, the LEAF-IR embedding model, a fixed-answer fake |
| queries and manual writes    | driving | oRPC, MCP, the CLI                                            |

[Enrichment](./enrichment.md) describes Jev and LEAF-IR. Manual writes are the links, retractions
and label corrections that people and agents send through the [API](./api.md).

Give a system a port only when it has at least two adapters, and count a test fake as one of them.
Two systems have one adapter each, so they get no port:

- The [store](./store.md) runs on Turso alone, and tests run against a real Turso file, so it has no
  fake.
- The [change feed](./change-feed.md) serves one protocol, Durable Streams.

Make each port report the outcomes that its system can produce. A timed-out append to s2-lite can
still land, as the [s2-lite spike](../../../research/s2-lite-durability/results.md) measured. The
fact log port therefore reports each append as acknowledged, rejected or unknown, and ingest repeats
an unknown append under the same fact ID. A port that reported only success or failure would let an
adapter turn an unknown append into a lost fact or a doubled one.

The host is written in Rust. Ingest and enrichment are written in TypeScript. The fact log and blob
store ports therefore have a Rust trait and a TypeScript interface. One set of fixture files, each a
sequence of calls with the results it expects, drives a conformance test on each side, so a change
to one definition fails the other side's test.

## Strategies

A processing step has strategies when it has more than one implementation with the same input and
the same output type. The owner picks one strategy for each step in the deployment, the TypeScript
package that assembles the owner's sources, queries and jobs. pepys never switches strategies at
runtime. Each strategy carries a version hash of its code and, where it has them, its model, prompt
and data files.

| Step                           | Runs in                |
| ------------------------------ | ---------------------- |
| extracting text from MIME      | the mail text job      |
| labelling an email             | the mail label job     |
| proposing candidate link pairs | the link judgement job |
| judging a candidate link pair  | the link judgement job |
| ranking search results         | the search query       |

The [link extractors](./links.md#link-extractors) have no strategies. Each extractor finds links
that the others miss, so the deployment runs every extractor.

## Champion and challenger

The champion is the version whose output the owner and the API's callers see. A challenger is a new
version that runs beside the champion, and nobody sees its output until the owner promotes it. A
strategy changes only through the job or query that runs it: a new strategy in a job makes a new job
version.

| Versioned thing | Champion recorded by | Challenger compared on                                         | Score against                                       | Promoted by                    |
| --------------- | -------------------- | -------------------------------------------------------------- | --------------------------------------------------- | ------------------------------ |
| consumer        | the host             | every fact up to the champion's offset in its stream           | nothing: the report is the row diff                 | `pepys up <consumer> --module` |
| enrichment job  | enrichment           | the inputs the champion processed, in the challenger's buckets | see the job table below                             | `pepys up enrich <job>`        |
| ranking         | the deployment       | the golden queries                                             | the results the owner expects for each golden query | a change to the deployment     |

A job promotion gives each consumer that reads the job a new
[consumer version](./host.md#consumer-versions), which the host builds to the side and swaps. A
consumer challenger stops at the champion's offset. Facts past that offset reach only the
challenger, so the diff would count them as changes the challenger's code made.

An enrichment challenger writes its facts under its own version, and every consumer reads only the
champion's facts. The owner therefore never sees the challenger's output, and that output cannot
shape the corrections that later score it.

Each enrichment job scores against the labelled data that matches its output. A job whose output has
no labelled data reports the diff alone, as a consumer does.

| Job                               | Score against                                           |
| --------------------------------- | ------------------------------------------------------- |
| mail label                        | the owner's label corrections                           |
| link judgement                    | the owner's manual links and link retractions           |
| embedding                         | the golden queries, run with the challenger's vectors   |
| mail text, git diff and git blame | nothing: the report is the diff of the extracted output |

`pepys up enrich <job>` promotes in three steps:

1. Enrichment runs the challenger on every scope that it has not yet processed.
2. Enrichment records the challenger as the job's champion.
3. The host rebuilds each consumer that reads the job's facts, to the side and with a swap, as
   `pepys up` does for a consumer. A consumer that kept its rows would still hold the old champion's
   output.

The evaluation report holds the diff, the score, the threshold that the challenger's version file
sets for the score, and the cost of the run, such as the number of model calls. The owner reads the
report, then runs the promotion command. The command shows no prompt, as
[decision 0018](../../decisions/0018-preview-and-up.md) sets out.

## Buckets

An enrichment challenger can run on a sample of its input before the owner promotes it, because each
model call costs money. A scope is the unit that a job's work belongs to, such as a Gmail thread or
a pull request. A hash of the scope ID puts each scope in one of 100 buckets, numbered 0 to 99. The
challenger's version record lists the buckets it runs on and the most model calls the run may make.
Enrichment refuses a run that would make more before its first call. The owner widens the sample
with `pepys sample enrich <job>`, and promotion covers the remaining scopes.

The bucket list sits outside the version hash, so widening the sample keeps the facts that the
challenger has written. A replay never reruns a job, because it reads the job's stored facts.

pepys buckets whole scopes, because a bucket per message could put the messages of one thread under
two job versions. Consumers replay every fact instead, because a replay is cheap and gives the same
output each time. The ranking scores against the golden queries instead, because one owner runs too
few queries for live statistics.

## Provisional contracts

Mark a contract that depends on a [spike](../../../research/README.md) that has not run as
provisional until the spike reports. Use a `@provisional <spike>` tag in its TSDoc comment, or a
`Provisional: <spike>` line in its Rust doc comment, where `<spike>` is the spike's folder name.

## Open questions

- Whether the deployment's default promotion gate refuses a challenger whose score is below its
  threshold, or only reports the score. The gate decides with no prompt either way.

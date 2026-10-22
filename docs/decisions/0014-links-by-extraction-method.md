# 0014: Link consumers split by extraction method

Date: 2026-10-22

## Decision

Each link consumer owns one way of finding links: source fields, references in text, notification
email headers, blame, model judgement, or manual assertions. Each owns a link table in its own file,
and a view unions them and applies retractions. Blame links are written for every merged pull
request, and whether a pull request was a fix is a filter applied at query time.

## Rejected alternatives

| Option                          | Why not                                                                           |
| ------------------------------- | --------------------------------------------------------------------------------- |
| one consumer per link type      | one method yields several types, and one type comes from several methods          |
| one consumer holding every rule | one bug forces a replay of every link                                             |
| blame only on fixes             | each change to the fix rule would mean running blame again over old pull requests |

## Why

The method decides cost, determinism and dependencies, and it is the unit that gets fixed and
replayed. Recording blame for every merge keeps facts free of meaning, so the person asking decides
what counts as a fix, and review findings can sharpen that answer later.

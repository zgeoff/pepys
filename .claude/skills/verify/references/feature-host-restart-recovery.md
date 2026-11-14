# host-restart-recovery

The host reads each consumer's fact stream from s2-lite. Each fact on `facts.github.pull_request`
has an offset, its sequence number from 0. The host saves the last offset it applied in the same
transaction as the rows that fact changed. When the host starts again, it reads on from the saved
offset + 1, so it applies each fact once. Ingest keeps storing facts while the host is stopped.

- Start the host again after a failure. When a step fails while the host is stopped, run
  `bun verify action start-host`, then the journey again from the top.
- Read `progress` as the `github_pull_request` consumer's: `appliedThrough` is its saved offset, and
  `tail` is the offset that the next fact on the stream will get.
- Run `use` the second time as written. Each `use` marks the current end of the `host` and `s2`
  logs, and `stream read host` and `host-reads` read from that mark, so they show only the restart.
- `send-webhook --count 40` sends pull requests numbered from `--number` up, here #200 to #239.
  Other journeys use numbers below 200.

## Journey

```bash
bun verify use --feature host-restart-recovery
bun verify action send-webhook --event opened --number 200 --title Buoy --count 40 --at 2026-10-06T08:00:00Z
bun verify caught-up
bun verify action stop-host
bun verify action send-webhook --event opened --number 240 --title Buoy --count 20 --at 2026-10-06T08:00:00Z
bun verify use --feature host-restart-recovery
bun verify action start-host
bun verify caught-up
bun verify host-reads --stream facts.github.pull_request
bun verify db query "select count(*) as pull_requests, count(distinct id) as ids from github_pull_request where number between 200 and 259"
bun verify db query "select (select count(*) from applied_facts) as applied, (select last_seq_num from offsets where stream = 'facts.github.pull_request') as saved_offset"
bun verify stream read host
```

## End state

- `stop-host` returns `data.host` `stopped`, `data.exitCode` 0, and `data.progress.appliedThrough`
  equal to `data.progress.tail` minus 1: the host had applied every fact when it stopped.
- `start-host` returns `data.host` `running`, the `appliedThrough` that `stop-host` returned, and a
  `tail` 20 higher than `stop-host` returned: ingest stored 20 facts while the host was stopped.
- `host-reads` returns exactly one read in `data.reads`, with `seqNum` equal to `appliedThrough`
  plus 1, and `count` 20: after the restart, the host read on from its saved offset.
- The first `db query` returns `pull_requests` 60 and `ids` 60: the consumer lost no fact.
- The second `db query` returns `applied` equal to `saved_offset` plus 1. The stream holds only pull
  request facts, from every journey of the run, at offsets 0 to `saved_offset`, and the consumer
  applied each of them once.
- `stream read host` holds a line that starts `github_pull_request` and ends
  `no swap, the version is current`. The host deploys a new version of a consumer when its code
  changes. This line shows that the host kept the consumer it had, with its database and saved
  offset.

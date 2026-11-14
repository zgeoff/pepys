# host-restart-recovery

The host runs each consumer over its fact stream on s2-lite. Each fact on
`facts.github.pull_request` has an offset, its sequence number from 0. With the rows of each batch,
the host saves the last offset it applied. When the host starts again, it reads from the saved
offset plus 1, so it applies each fact once. Ingest, the service that receives webhooks, keeps
storing facts while the host is stopped.

- Run this journey last, on a run where no other journey is mid-way: it stops the host.
- When a step fails after `stop-host`, run `bun verify action start-host` before anything else.
- `stop-host` and `start-host` report `progress` for the `github_pull_request` consumer:
  `appliedThrough` is the saved offset, and `tail` is the offset the next fact will get.
- The second `use` marks where `stream read host` and `host-reads` start, so they show only the
  restart.

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
  equal to `data.progress.tail` minus 1: the host had applied every fact.
- `start-host` returns `data.host` `running`, the same `appliedThrough` as `stop-host`, and a `tail`
  20 higher than `stop-host`'s: the 20 facts that ingest stored while the host was stopped.
- `host-reads` returns one read in `data.reads`, with `seqNum` equal to `start-host`'s
  `appliedThrough` plus 1, and `count` 20: the host read on from its saved offset.
- The first `db query` returns `pull_requests` 60 and `ids` 60: no fact lost.
- The second `db query` returns `applied` equal to `saved_offset` plus 1: the stream holds only pull
  request facts, from offset 0, and the host applied each once.
- `stream read host` holds a line that starts `github_pull_request` and ends
  `no swap, the version is current`: the host kept its deployed consumer, with its database and
  saved offset, and built no new one.

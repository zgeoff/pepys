# host-restart-recovery

The host saves each consumer's offset on its stream with the rows it applies. When it stops and
starts again, it resumes after the saved offset, so it applies each fact once: none is lost, and
none twice. Ingest keeps taking facts while the host is down.

The journey opens pull requests #200 to #239, stops the host, opens #240 to #259 while it is down,
then starts it again. Each pull request is one fact on `facts.github.pull_request`.

## Journey

```bash
bun verify use --feature host-restart-recovery
bun verify action send-webhook --event opened --number 200 --title Buoy --count 40 --at 2026-10-06T08:00:00Z
bun verify caught-up
bun verify action stop-host
bun verify action send-webhook --event opened --number 240 --title Buoy --count 20 --at 2026-10-06T08:00:00Z
bun verify action start-host
bun verify caught-up
bun verify db query "select count(*) as pull_requests, count(distinct id) as ids from github_pull_request where number between 200 and 259"
bun verify db query "select (select count(*) from applied_facts) as applied, (select last_seq_num from offsets where stream = 'facts.github.pull_request') as last_seq_num"
bun verify stream read host
```

## End state

- `stop-host` returns `data.host` `stopped`, `data.exitCode` 0, and a `data.progress` whose
  `appliedThrough` is its `tail` minus 1: the host had applied every fact when it stopped.
- `start-host` returns `data.host` `running` and the same `appliedThrough`, with a `tail` 20 higher:
  the 20 facts sent while the host was down wait after the saved offset.
- The first `db query` returns `pull_requests` 60 and `ids` 60: no fact lost.
- The second returns `applied` equal to `last_seq_num` plus 1: one applied fact per offset, from 0,
  so no fact applied twice.
- `stream read host` holds the line `github_pull_request <hash>: no swap, the version is current`:
  the host started on its saved version and offset, with no rebuild.

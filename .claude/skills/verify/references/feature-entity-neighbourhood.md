# entity-neighbourhood

A reader looks an entity up with `get_entity`, by its ID or an alias, then walks its links with
`neighbourhood`. In the e2e deployment the GitHub consumers declare no links, so the one link to a
pull request is a logbook voyage's `logbook_voyage_cites`. The walk follows a link in either
direction.

The journey opens pull request #47, then sends voyage `v-47`, which cites it.

## Journey

```bash
bun verify use --feature entity-neighbourhood
bun verify action send-webhook --event opened --number 47 --title 'Chart the north channel' --at 2026-10-04T08:00:00Z
bun verify action send-voyage --voyage v-47 --title 'Sounding the north channel' --cites 47 --at 2026-10-05T07:00:00Z
bun verify caught-up
bun verify query entity --id 'acme/harbour#47'
bun verify query neighbourhood --id github:pull_request:1874433056
```

## End state

- `query entity` returns `data.entity.id` `github:pull_request:1874433056`, with `title`
  `Chart the north channel` and `actor` `github:user:4401`, its author.
- `query neighbourhood` returns two entities in `data.entities`: the pull request at `depth` 0, and
  `logbook:voyage:v-47` at `depth` 1.
- Its `data.links` holds one link: `type` `logbook_voyage_cites`, `from` `logbook:voyage:v-47`, `to`
  the pull request, `direction` `incoming`.
- `data.unresolved` and `data.skippedConsumers` are empty.

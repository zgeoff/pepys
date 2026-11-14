# entity-neighbourhood

An API client looks an entity up with `get_entity`, by its ID or by an alias, then lists the
entities linked to it with `neighbourhood`. The CLI calls them with `query entity` and
`query neighbourhood`.

- `send-webhook` builds a pull request with the GitHub ID 1874433009 plus its number, so #47 is
  `github:pull_request:1874433056`. Every pull request is in the repo `Acme/Harbour`, by the user
  4401, so its alias is `acme/harbour#47` and its `actor` is `github:user:4401`.
- In the e2e deployment, no GitHub consumer writes links. The only link that can point at a pull
  request is a `logbook_voyage_cites` link, which a logbook voyage writes. A voyage is a trip that
  the test plug-in `logbook` records.
- `neighbourhood` follows a link in either direction. Its `direction` is relative to the entity the
  walk starts from.

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

- `query entity` returns `data.entity.id` `github:pull_request:1874433056`, `title`
  `Chart the north channel` and `actor` `github:user:4401`.
- `query neighbourhood` returns two entities in `data.entities`, in any order:
  `github:pull_request:1874433056` at `depth` 0, and `logbook:voyage:v-47` at `depth` 1.
- `query neighbourhood` returns one link in `data.links`: `type` `logbook_voyage_cites`, `from`
  `logbook:voyage:v-47`, `to` `github:pull_request:1874433056` and `direction` `incoming`.
- `data.unresolved` and `data.skippedConsumers` are empty arrays.

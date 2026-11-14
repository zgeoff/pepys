# entity-neighbourhood

An API client calls `get_entity` to read one entity, by its ID or by an alias, and `neighbourhood`
to list the entities linked to it. The CLI's `query entity` and `query neighbourhood` call them
through the API. Run the journey, then compare what each query returns with the end state.

- Use the IDs the journey uses. `send-webhook` gives a pull request the GitHub ID 1874433009 + its
  number, in the repo `Acme/Harbour`, by the GitHub user 4401. Pull request #47 therefore has the
  entity ID `github:pull_request:1874433056`, the alias `acme/harbour#47`, and the `actor`
  `github:user:4401`.
- Call `query neighbourhood` with the entity ID: it refuses an alias.
- Expect exactly one link. The e2e deployment's GitHub consumers never write a link. The test
  plug-in `logbook` records voyages, and its consumer writes a `logbook_voyage_cites` link from a
  voyage to each pull request the voyage cites. `send-voyage --cites 47` sends a voyage that cites
  #47.
- Read `direction` from the pull request: `neighbourhood` follows links in both directions, and
  marks a link `incoming` when it points at the entity you asked about.

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

- `query entity` returns `data.entity` with `id` `github:pull_request:1874433056`, `title`
  `Chart the north channel` and `actor` `github:user:4401`.
- `query neighbourhood` returns exactly two entities in `data.entities`, in any order:
  `github:pull_request:1874433056` at `depth` 0, and `logbook:voyage:v-47` at `depth` 1.
- `query neighbourhood` returns exactly one link in `data.links`: `type` `logbook_voyage_cites`,
  `from` `logbook:voyage:v-47`, `to` `github:pull_request:1874433056`, and `direction` `incoming`.
- `query neighbourhood` returns `data.unresolved` and `data.skippedConsumers` as empty arrays.

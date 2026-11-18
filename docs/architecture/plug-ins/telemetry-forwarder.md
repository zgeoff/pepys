# The telemetry forwarder

A machine outside impz sends its exports through the forwarder, a program in
`@pepys/source-telemetry`. The agent's exporter posts to the forwarder on the machine's loopback
address. The forwarder appends each export to a spool file, one file per UTC day, and sends it from
there to the [sender route](./telemetry.md#the-sender-route) with an identity token that the machine
signs with its own key. The deployment holds only the public half of the key, in a trust document
that `install` prints.

The receiver and the send loop share only the spool files. The receiver answers 200 to a log export
once its line is on disk, whatever ingest does, so an outage of ingest costs no export, Codex's
included, which never sends an export again. It answers metrics and traces 200 and stores nothing,
as ingest stores neither, and answers 415, 400 or 503 for a wrong content type, a body that is no
JSON and a failed append.

- **Spool.** Each line holds the receipt time, the path, the `user-agent` and the parsed body, in
  the line format of the script that the forwarder replaces, so its files load with no conversion.
  `positions.json` holds the byte offset of the first unsent line of each file. A line that ingest
  refuses for good, or that the forwarder cannot send, goes to the file of the same name under
  `failed/` with the reason. A sent file is deleted a week after the send loop first found it sent,
  and a file under `failed/` is never deleted.
- **Send loop.** One request is in flight, and the newest file with an unsent line goes first, so a
  load of history never delays today's exports. A 2xx moves the position. A 400, 413, 415 or 422
  moves the line to `failed`. A 500 stops the loop, and after the fourth 500 for one line the line
  goes to `failed`. A 401, 403 or 404 stops it with a slow retry. Any other answer, or none, waits
  with a doubling back-off. No request goes out during a wait. The loop holds a last line with no
  line break in the newest file, which the receiver may still be writing, and sends it from an older
  file. It stops and sends nothing when `positions.json` does not parse or holds an offset past the
  end of a file, so the owner decides between a repair and a resend.
- **Identity.** The key and the machine's ID live in files that only the machine's user can read.
  The token's `iat` lies a little in the past, so a machine clock that runs ahead of ingest's still
  passes. The header `imp-identity` and the claim `imp_name` keep impz's names, because ingest
  checks the token with the verifier that checks an imp's token.
- **Health.** `GET /health` answers the send state, `off`, `sending`, `waiting` or `stopped`, with
  the count of failed lines, and answers 503 only in `stopped`. With no ingest URL the forwarder
  runs the receiver alone, and the state stays `off`.

`install` makes the key and the machine's ID when the identity folder holds none, writes a systemd
user unit that runs the installed bin file by its absolute path, and prints the trust document. It
enables and starts nothing, and never replaces a key or an ID, so a second run prints the same
document. [The package README](../../../packages/source-telemetry/README.md#the-forwarder) lists the
settings.

A resend of an export changes nothing in the store, because each fact ID comes from the record. It
can add a second copy to the fact log after ingest's recent-body window has passed. Every process of
the machine's user can post to the receiver and read the key, so the machine is one sender, and the
forwarder holds no shared token.
[The sender route](../../design/telemetry-forwarder/sender-route.md#who-can-write-through-the-route)
gives what a caller can write through it.

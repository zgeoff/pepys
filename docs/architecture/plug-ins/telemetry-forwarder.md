# The telemetry forwarder

A coding agent on the owner's PC exports its OTLP log records to a program on the same machine, the
forwarder, and the forwarder sends them on to pepys. The PC needs the forwarder because the PC holds
no identity that ingest trusts: [impz](../ingest/ingest.md#the-sender-proof) gives each of its
virtual machines an identity token, and a machine outside impz has none. The forwarder makes a key
for the machine, and signs a token of the same form with it.

The forwarder is the program `pepys-telemetry-forwarder` of `@pepys/source-telemetry`, with two
commands. `run` starts its two parts:

- The receiver takes each export from the agent's exporter on the machine's loopback address, and
  appends it to a spool file.
- The send loop reads the spool files, and posts each export to the
  [sender route](./telemetry.md#the-sender-route) of ingest.

`install` sets a machine up, as [Identity and install](#identity-and-install) describes.

## The receiver

The receiver's answer to an exporter depends only on the append to the spool file, never on ingest.
The receiver answers 200 to a log export once the export's line is on disk, so an outage of ingest
loses no export. The exporter of Codex, one of the agents, never sends a failed export a second
time. A receiver that waited on ingest before it answered would therefore lose Codex's exports in
every outage.

| The request                                    | The receiver answers       |
| ---------------------------------------------- | -------------------------- |
| a log export, stored                           | 200                        |
| a log export, and the append fails             | 503                        |
| a body that is not JSON                        | 400                        |
| a content type other than `application/json`   | 415                        |
| a metrics or traces export                     | 200, and it stores nothing |
| `GET /health`, with the send loop in `stopped` | 503, with the send state   |
| `GET /health`, in every other state            | 200, with the send state   |

The receiver stores no metrics and no traces because ingest stores neither. The body of
`GET /health` holds the [send state](#the-send-loop) and the count of lines in the `failed` files.
With no ingest URL set, `run` starts the receiver alone, and the send state is `off`.

## The spool folder

The receiver and the send loop share only the files of the spool folder. The receiver therefore
stores exports while the send loop waits on ingest, and the send loop sends the spool while no
export arrives.

| File                       | Holds                                                         | Written by                                      |
| -------------------------- | ------------------------------------------------------------- | ----------------------------------------------- |
| `<UTC day>-logs.jsonl`     | one export per line, for the exports received on that day     | the receiver                                    |
| `positions.json`           | for each spool file, the byte offset of its first unsent line | the send loop, and `run` for a new spool folder |
| `failed/<spool file name>` | each line of that spool file that the send loop gave up on    | the send loop                                   |
| `forwarder.lock`           | the lock of the `run` process                                 | `run`                                           |

A line holds the time of receipt, the path `/v1/logs`, the exporter's `user-agent` and the export as
parsed JSON. The send loop never deletes a file under `failed/`. It deletes a spool file of an
earlier day a week after it first finds the file with no unsent line, and it keeps the time of that
find in `positions.json`, so a restart of `run` leaves the week as it was. A line that the send loop
gave up on counts as sent.

At most one `run` process works on a spool folder, because two send loops would each overwrite the
positions that the other wrote. `run` holds a kernel lock on `forwarder.lock` for as long as it
runs, and a second `run` on the same folder logs an error and exits 1. The kernel frees the lock
when the process ends, so a `run` that crashed never blocks the next one.

The forwarder calls `fsync` on each file it writes, and on the folder that lists a file it made or
renamed, before it acts on the write. When it makes or opens the spool, `failed` or identity folder,
it also syncs each folder above it up to the root, since an earlier process can have stopped before
those syncs. A power failure therefore loses nothing that the forwarder has acted on:

- The receiver answers 200 only after the sync of the export's line.
- The send loop moves the position past a line that it gave up on only after the sync of the line's
  copy under `failed/`.
- The send loop sends the next line only after the sync of the new `positions.json`, which it writes
  to a temporary file and renames.

## The send loop

The send loop has one request in flight. Before each request it picks the newest spool file that
holds an unsent line, and sends the first unsent line of that file. An export of today therefore
never waits behind the unsent lines of earlier days. The send loop has two waits, and the code sets
the length of each. The retry wait doubles after each answer of the table's last row, up to a limit,
and returns to its first length when the position moves. The slow wait is one fixed length, longer
than that limit. The send loop acts on each answer of ingest by the first row that fits:

| Ingest answers             | The send loop                                                             | Send state |
| -------------------------- | ------------------------------------------------------------------------- | ---------- |
| 2xx                        | moves the position past the line, and sends the next line after the pause | `sending`  |
| 400, 413, 415 or 422       | copies the line to `failed/`, moves the position, and goes on             | `sending`  |
| 500, the first three times | keeps the line, and sends it again after the slow wait                    | `stopped`  |
| 500, the fourth time       | copies the line to `failed/`, moves the position, and goes on             | `sending`  |
| 401, 403 or 404            | keeps the line, and sends it again after the slow wait                    | `stopped`  |
| any other answer, or none  | keeps the line, and sends it again after the retry wait                   | `waiting`  |

- Ingest answers 400, 413, 415 or 422 only for a body that it refuses on every resend, so the send
  loop gives up on the line at once.
- A 500 can come from a fault of the deployment or from one export, so the send loop tries the line
  four times before it gives up on it. It counts the 500 answers of a line in memory.
- A 401, 403 or 404 means that the deployment does not trust the machine or has no sender route. The
  owner repairs that, so the send loop keeps every line.

After a 2xx, the send loop pauses before the next request until the body bytes of the last one have
passed at the rate in `PEPYS_FORWARDER_MAX_BYTES_PER_SECOND`, whose default
[the package README](../../../packages/source-telemetry/README.md) gives. The default lets a
multi-gigabyte backlog drain over many hours, so a backlog cannot flood ingest again, and steady
traffic of small exports never waits. A large export holds the next request back for its size
divided by the rate.

The send loop sends no request during a wait or the pause, whatever the receiver stores. In
`stopped`, `GET /health` answers 503, because most answers of that state need the owner: a
deployment that does not trust the machine, or a fault of the deployment.

These cases need no answer from ingest:

- The send loop copies a line to `failed/`, with no request, when the line is not a JSON object that
  holds the path `/v1/logs` and an export.
- The send loop leaves the last line of the newest spool file unsent while the line has no line
  break at its end, because the receiver can still be writing that line. In an older spool file, the
  send loop sends a last line with no line break.
- The send loop enters `stopped`, logs the reason once and sends nothing when `positions.json` is
  missing while a spool file is there, does not parse, or holds an offset past the end of its spool
  file. `run` makes an empty `positions.json` only for a spool folder with no spool file, so a lost
  file never sends the whole spool again by itself. The send loop reads the file again after each
  slow wait. The owner then writes the file back, or writes `{}` into it to send every spool file
  again from its start.

When the forwarder sends an export a second time, the tables that the queries read stay the same,
because
[each fact ID comes from the export's own record](./telemetry.md#one-record-becomes-one-fact), and
the host applies a fact ID once. Ingest drops a body that it stored in the last hour.
[A later resend](../ingest/ingest.md#why-a-fact-id-comes-from-the-signed-body) adds a second copy of
the facts to the fact log, the record of every fact that ingest stored, and changes nothing else.

## Identity and install

`install` makes a P-256 key and a random machine ID in the identity folder,
`PEPYS_FORWARDER_IDENTITY_DIR`, in files that only the machine's user can read. The machine ID is
the subject of each token. It writes a systemd user unit that runs `run`, and prints the machine's
trust document: the issuer name that the owner gave `install`, and the public half of the key. The
owner adds that document to the [folder of trust documents](./telemetry.md#the-sender-route) of the
deployment, which is how ingest comes to trust the machine. The deployment never holds the private
half.

`install` enables and starts nothing, and never replaces a key or a machine ID that the identity
folder holds. A second `install` therefore prints the same trust document.
[The package README](../../../packages/source-telemetry/README.md#the-forwarder) gives the commands
and the settings.

The send loop signs a new token for each request. The token's `iat` is earlier than the machine's
clock by a fixed shift, because ingest refuses a token whose `iat` is ahead of its own clock, and
the clock of a PC can run ahead. The header is named `imp-identity` and the claim `imp_name`, as
impz names them, because ingest checks the token with the verifier that checks a token from impz.

Every process of the machine's user can post to the receiver, and can read the key. Ingest can
therefore tell one machine from another, and cannot tell the processes of one machine apart.
[Who can write through the route](../../design/telemetry-forwarder/sender-route.md#who-can-write-through-the-route)
lists what that lets a process write.

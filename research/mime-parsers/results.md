# MIME parsers: results

The spike ran on an invented corpus of 24 raw messages, so it is partial until it runs on the
owner's mail. No parser passes the check: every one loses the body of the message whose boundary
does not match its header. Of the 23 messages with a body, `postal-mime` with `html-to-text` for
HTML-only messages reads 22, `mailparser` 20, and `postal-mime` alone 19. The [README](README.md)
holds the question and the answer.

## Method

1. Build 24 raw messages as bytes, each with the phrases its plain text must hold, its attachments
   with their SHA-256, and the headers the mail jobs read.
2. Parse each message with three strategies: `postal-mime` alone, `postal-mime` with `html-to-text`
   when the message has no text part, and `mailparser`.
3. Score the plain text, the subject, the sender's name, the attachment list and the headers against
   the expected values, and record each crash.
4. Time each strategy on each message: 5 warm-up parses, then the median and the slowest of 50 timed
   parses.

The runner feeds every parser a `Uint8Array`, never a JavaScript string, so a Shift_JIS or
Windows-1252 body reaches the parser as the bytes a mail server sends. Every message uses CRLF line
endings except the one that tests LF.

The plain text of a message is readable when it holds every expected phrase and none of the leak
markers below. One message, cut off inside its headers, has no body and expects no phrase, so the
runner counts it as neither readable nor unreadable. A phrase matches when it appears after the
runner collapses whitespace and lowers case on both sides, since a converter may wrap lines or
capitalize a heading.

| Leak marker               | What it catches                      |
| ------------------------- | ------------------------------------ |
| U+FFFD                    | bytes the decoder could not map      |
| `Ã`, `â€`, `Â£`           | UTF-8 decoded as Latin-1             |
| `‚±`, `‚ñ`                | Shift_JIS decoded as Latin-1         |
| `=XX`, `=` at a line end  | an undecoded quoted-printable escape |
| `=?charset?B?`            | an undecoded RFC 2047 word           |
| `Content-Type:` at a line | a part header in the body            |
| a `--boundary` line       | a boundary in the body               |
| `<p`, `<div`, `<img` …    | HTML in the plain text               |
| a 60-character base64 run | an undecoded base64 body             |

The spike passes when one strategy gives readable text for every message with a body and crashes on
none, and the spike names it. On the owner's mail, which has no expected phrases, the check is no
crash, some text, and no leak marker.

## Setup

The spike ran on Bun 1.4.4, the version `.bun-version` pins, with `postal-mime` 4.1.4, `mailparser`
3.12.4 and `html-to-text` 10.0.1, on an AMD Ryzen 7 9800X3D with 16 threads under WSL2 (Linux
6.6.87.2). Each package version is the newest release at least 7 days old on 2026-11-04.
`mailparser` 3.12.4 depends on `html-to-text` 10.0.1, so both converters are the same code.
`html-to-text` 10 ships no types, so [html-to-text.d.ts](html-to-text.d.ts) declares its `convert`
function.

Both parsers run with their default options. `mailparser` takes a `Buffer`, so its time includes one
copy of the message. The runner exits non-zero when no strategy passes. Run it from the repo root:

```bash
bun run --filter ./research/mime-parsers check
```

The corpus lives in four files: [build-everyday-fixtures.ts](build-everyday-fixtures.ts),
[build-charset-fixtures.ts](build-charset-fixtures.ts),
[build-malformed-fixtures.ts](build-malformed-fixtures.ts) and
[build-large-fixtures.ts](build-large-fixtures.ts). Every name, address, repository and amount in
them is invented. The spike uses none of the parsers' own test fixtures, because nothing shows that
those messages were not real people's mail.

The same runner checks a folder of `.eml` files when it gets one as its argument, and prints only
counts and file names, never a header, a body or an attachment:

```bash
bun research/mime-parsers/run-spike.ts <folder_of_eml_files>
```

## Text

| Message                            | What it covers                                       | `postal-mime` | `+ html-to-text` | `mailparser` |
| ---------------------------------- | ---------------------------------------------------- | ------------- | ---------------- | ------------ |
| `newsletter-html-only`             | HTML only, quoted-printable, soft breaks             | no text       | readable         | readable     |
| `newsletter-alternative`           | quoted-printable text part, base64 HTML part         | readable      | readable         | readable     |
| `receipt`                          | Windows-1252 euro sign, nested alternative, a PDF    | readable      | readable         | readable     |
| `github-notification`              | `X-GitHub-*` and `List-ID` headers                   | readable      | readable         | readable     |
| `reply-quoted-history`             | quoted history two levels deep                       | readable      | readable         | readable     |
| `nested-mixed`                     | mixed, alternative and related, three attachments    | readable      | readable         | readable     |
| `inline-image`                     | HTML only inside `multipart/related`, a `cid:` image | no text       | readable         | no text      |
| `base64-text`                      | base64 UTF-8 with an emoji                           | readable      | readable         | readable     |
| `forwarded-rfc822`                 | a forward with a `message/rfc822` part               | readable      | readable         | readable     |
| `iso-8859-1`                       | 8bit Latin-1 body, Q-encoded subject and sender      | readable      | readable         | readable     |
| `windows-1252`                     | curly quotes, en dash, euro sign                     | readable      | readable         | readable     |
| `windows-1252-labelled-iso-8859-1` | bytes 0x80 to 0x9F in a part labelled ISO-8859-1     | readable      | readable         | readable     |
| `shift-jis`                        | 8bit Shift_JIS, B-encoded subject, RFC 2231 filename | readable      | readable         | readable     |
| `iso-2022-jp`                      | ISO-2022-JP body and subject                         | readable      | readable         | readable     |
| `rfc2047-headers`                  | encoded words in two charsets, folded, in a filename | readable      | readable         | readable     |
| `undeclared-8bit-utf8`             | raw UTF-8 in the subject, no charset parameter       | readable      | readable         | readable     |
| `lf-line-endings`                  | LF line endings, as an mbox export stores them       | readable      | readable         | readable     |
| `malformed-wrong-boundary`         | a declared boundary the body never uses              | no text       | no text          | no text      |
| `malformed-no-boundary-parameter`  | `multipart/mixed` with no boundary parameter         | readable      | readable         | no text      |
| `malformed-no-closing-boundary`    | no closing boundary                                  | readable      | readable         | readable     |
| `truncated-mid-attachment`         | cut off inside a base64 attachment                   | readable      | readable         | readable     |
| `truncated-in-headers`             | cut off inside the header block, no body             | no body       | no body          | no body      |
| `large-html-newsletter`            | 1,500 table rows of HTML only, 146,370 bytes         | no text       | readable         | readable     |
| `large-attachment`                 | a 5 MiB base64 attachment                            | readable      | readable         | readable     |

`truncated-in-headers` has no body to read, and every strategy keeps its subject and sender.

No strategy crashed on any message, and no plain text held a leak marker. Every strategy decoded
every subject and sender name, the three non-UTF-8 charsets, ISO-2022-JP and Windows-1252 bytes in a
part labelled ISO-8859-1.

`postal-mime` leaves `text` undefined whenever a message has no `text/plain` part, and returns the
HTML alone. `mailparser` converts the HTML with `html-to-text` in that case, except when the HTML
sits inside `multipart/related`: on `inline-image` it returns neither text nor an error. Running
`html-to-text` on `postal-mime`'s HTML closes both gaps.

`html-to-text` capitalizes headings and writes a link as `Read more [https://…]`, in both
`mailparser` and the `postal-mime` strategy. In the `postal-mime` strategy, it also writes the
inline image as `[cid:logo-1]`.

On `malformed-wrong-boundary`, every strategy returns no text, no HTML and no attachment, with no
error. On `malformed-no-boundary-parameter`, `postal-mime` reads the body as text and `mailparser`
returns nothing.

## Attachments

All three strategies return every expected attachment on every message, with the expected filename,
MIME type and SHA-256, and the expected inline or attached flag. That covers the RFC 2231 filename
`見積.pdf`, the RFC 2047 filename `ordre du jour été.txt`, an inline image with no filename, and the
5 MiB attachment. On `truncated-mid-attachment`, each returns the 30 bytes that the 41 base64
characters before the cut decode to, with the expected SHA-256, under its filename.

Both parsers return the forwarded message as a `message/rfc822` attachment, and neither puts its
text in the plain text. `mailparser` rewrites each `cid:` link in its HTML to a `data:` URL holding
the image. `postal-mime` leaves the link as it is.

## Headers

Both parsers keep each header line, so `X-GitHub-Reason`, `X-GitHub-Sender`, `List-ID` and
`In-Reply-To` read back with their sent values from both.

## Time

The table gives the median of 50 parses, in milliseconds, as the lowest and highest of 3 runs.

| Message                     | `postal-mime` | `+ html-to-text` | `mailparser`  |
| --------------------------- | ------------- | ---------------- | ------------- |
| median of the 22 small ones | 0.020–0.023   | 0.019–0.024      | 0.075–0.096   |
| `newsletter-html-only`      | 0.102–0.130   | 0.396–0.450      | 0.640–0.697   |
| `github-notification`       | 0.045–0.048   | 0.054–0.072      | 0.248–0.314   |
| `large-html-newsletter`     | 1.014–1.169   | 4.454–5.971      | 14.618–14.729 |
| `large-attachment` (5 MiB)  | 38.466–39.490 | 38.363–41.874    | 25.004–26.849 |

`postal-mime` parses a small message 3.5 to 4.5 times faster than `mailparser`. On the HTML
newsletter of 146,370 bytes, `postal-mime` with `html-to-text` takes about 5 ms and `mailparser`
about 15 ms, for the same text. On the 5 MiB attachment, `mailparser` is about 1.5 times faster.
Each strategy took more than 2 ms on some small message in some run, and 4.8 ms at the slowest, so
the tables use the median as the measure of each strategy.

## Untested

- The owner's real mail: the 200 messages that the original method asks for. The owner exports them,
  then runs the folder command in [Setup](#setup). One way, with a Gmail Takeout export of one label
  as `<export>.mbox`, splits it into one file per message first:

  ```bash
  mkdir <folder_of_eml_files>
  awk -v dir=<folder_of_eml_files> '/^From /{n++; f=sprintf("%s/%04d.eml", dir, n); next} {print > f}' <export>.mbox
  bun research/mime-parsers/run-spike.ts <folder_of_eml_files>
  ```

  The split leaves the `>From ` escaping of an mbox body in place.

- Mail through the Gmail API with `format=raw`, which needs a Gmail credential that pepys does not
  hold.
- Messages over 5 MiB, and memory use.
- TNEF (`winmail.dat`), S/MIME, PGP, calendar invitations, and a `message/rfc822` part nested more
  than one level deep.
- Charsets beyond the five here, such as GB2312, Big5, KOI8-R and EUC-KR.
- Options other than the defaults, such as `postal-mime`'s `rfc822Attachments` or `mailparser`'s
  `skipHtmlToText`.
- Bun releases other than 1.4.4, and the k3s server.

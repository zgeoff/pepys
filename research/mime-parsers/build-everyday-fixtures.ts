// Every message here is invented: the names, addresses, repositories and amounts are made up.

import { buildBase64Lines } from './build-base64-lines.ts';
import { buildRaw } from './build-raw.ts';
import { pdfBytes, pngBytes } from './constants.ts';
import { toSHA256 } from './to-sha256.ts';
import type { Fixture } from './types.ts';

export function buildEverydayFixtures(): Fixture[] {
  return [
    buildNewsletterHTMLOnly(),
    buildNewsletterAlternative(),
    buildReceipt(),
    buildGitHubNotification(),
    buildReplyWithQuote(),
    buildNestedMixed(),
    buildInlineImage(),
    buildBase64Text(),
    buildForwarded(),
  ];
}

function buildNewsletterHTMLOnly(): Fixture {
  return {
    name: 'newsletter-html-only',
    covers:
      'an HTML-only newsletter in quoted-printable, with soft line breaks and =3D in attributes',
    raw: buildRaw([
      'From: Allotment Weekly <news@allotment-weekly.example>\n',
      'To: reader@example.net\n',
      'Subject: The autumn issue is here\n',
      'Date: Mon, 02 Nov 2026 08:00:00 +0000\n',
      'Message-ID: <issue-41@allotment-weekly.example>\n',
      'MIME-Version: 1.0\n',
      'List-Unsubscribe: <https://allotment-weekly.example/unsub?id=7781>\n',
      'Content-Type: text/html; charset=UTF-8\n',
      'Content-Transfer-Encoding: quoted-printable\n',
      '\n',
      '<html><head><style>p{color:#333}</style></head><body>\n',
      '<table width=3D"100%"><tr><td><h1>The autumn issue</h1></td></tr></table>\n',
      '<p>This week we cover garlic planting, leaf mould and the best time to lift=\n',
      ' dahlias before the first frost.</p>\n',
      '<p><a href=3D"https://allotment-weekly.example/a/41">Read more</a> =E2=80=94 and=\n',
      ' see you at the seed swap.</p>\n',
      '</body></html>\n',
    ]),
    expected: {
      subject: 'The autumn issue is here',
      fromName: 'Allotment Weekly',
      textIncludes: [
        'The autumn issue',
        'the best time to lift dahlias before the first frost',
        'Read more',
        '— and see you at the seed swap',
      ],
      htmlOnly: true,
      attachments: [],
      headers: {},
    },
  };
}

function buildNewsletterAlternative(): Fixture {
  const html =
    '<html><body><h2>Five new trails</h2><p>Our members mapped five new trails in the hills above Larkfield.</p></body></html>';

  return {
    name: 'newsletter-alternative',
    covers: 'multipart/alternative with a quoted-printable text part and a base64 HTML part',
    raw: buildRaw([
      'From: "Trail Club" <hello@trailclub.example>\n',
      'To: reader@example.net\n',
      'Subject: Five new trails this month\n',
      'Date: Tue, 03 Nov 2026 07:30:00 +0000\n',
      'Message-ID: <nl-2026-11@trailclub.example>\n',
      'MIME-Version: 1.0\n',
      'Content-Type: multipart/alternative; boundary="alt-7f3a"\n',
      '\n',
      '--alt-7f3a\n',
      'Content-Type: text/plain; charset=UTF-8\n',
      'Content-Transfer-Encoding: quoted-printable\n',
      '\n',
      'Five new trails\n',
      '\n',
      'Our members mapped five new trails in the hills above Larkfield. The longe=\n',
      'st runs 14 km.\n',
      '\n',
      '--alt-7f3a\n',
      'Content-Type: text/html; charset=UTF-8\n',
      'Content-Transfer-Encoding: base64\n',
      '\n',
      buildBase64Lines(new TextEncoder().encode(html)),
      '--alt-7f3a--\n',
    ]),
    expected: {
      subject: 'Five new trails this month',
      fromName: 'Trail Club',
      textIncludes: ['Five new trails', 'The longest runs 14 km.'],
      htmlOnly: false,
      attachments: [],
      headers: {},
    },
  };
}

function buildReceipt(): Fixture {
  return {
    name: 'receipt',
    covers:
      'a receipt in multipart/mixed, Windows-1252 quoted-printable text with a euro sign, and a PDF',
    raw: buildRaw([
      'From: Bakery Lund <orders@bakery-lund.example>\n',
      'To: reader@example.net\n',
      'Subject: Your receipt #20441\n',
      'Date: Wed, 04 Nov 2026 12:10:00 +0100\n',
      'Message-ID: <r20441@bakery-lund.example>\n',
      'MIME-Version: 1.0\n',
      'Content-Type: multipart/mixed; boundary=mix-01\n',
      '\n',
      '--mix-01\n',
      'Content-Type: multipart/alternative; boundary=alt-01\n',
      '\n',
      '--alt-01\n',
      'Content-Type: text/plain; charset=windows-1252\n',
      'Content-Transfer-Encoding: quoted-printable\n',
      '\n',
      'Order 20441\n',
      '2 x Sourdough loaf     =8012.00\n',
      'Total                  =8012.00\n',
      '\n',
      '--alt-01\n',
      'Content-Type: text/html; charset=windows-1252\n',
      'Content-Transfer-Encoding: quoted-printable\n',
      '\n',
      '<p>Order 20441</p><p>Total <b>=8012.00</b></p>\n',
      '--alt-01--\n',
      '\n',
      '--mix-01\n',
      'Content-Type: application/pdf; name="receipt-20441.pdf"\n',
      'Content-Disposition: attachment; filename="receipt-20441.pdf"\n',
      'Content-Transfer-Encoding: base64\n',
      '\n',
      buildBase64Lines(pdfBytes),
      '--mix-01--\n',
    ]),
    expected: {
      subject: 'Your receipt #20441',
      fromName: 'Bakery Lund',
      textIncludes: ['Order 20441', '2 x Sourdough loaf', '€12.00'],
      htmlOnly: false,
      attachments: [
        {
          filename: 'receipt-20441.pdf',
          mimeType: 'application/pdf',
          inline: false,
          sha256: toSHA256(pdfBytes),
        },
      ],
      headers: {},
    },
  };
}

function buildGitHubNotification(): Fixture {
  return {
    name: 'github-notification',
    covers: 'a GitHub pull request notification with X-GitHub-* and List-ID headers',
    raw: buildRaw([
      'Date: Wed, 04 Nov 2026 09:14:05 -0800\n',
      'From: Rowan Pike <notifications@github.com>\n',
      'Reply-To: example-org/widgets <reply+ABCDEF123@reply.github.com>\n',
      'To: example-org/widgets <widgets@noreply.github.com>\n',
      'Cc: Subscribed <subscribed@noreply.github.com>\n',
      'Message-ID: <example-org/widgets/pull/212/review/9001@github.com>\n',
      'In-Reply-To: <example-org/widgets/pull/212@github.com>\n',
      'References: <example-org/widgets/pull/212@github.com>\n',
      'Subject: Re: [example-org/widgets] Add a retry to the sprocket loader (PR #212)\n',
      'Mime-Version: 1.0\n',
      'Content-Type: multipart/alternative; boundary="--==_mimepart_6729f1a5_3c";\n',
      ' charset=UTF-8\n',
      'Content-Transfer-Encoding: 7bit\n',
      'Precedence: list\n',
      'X-GitHub-Sender: rowanpike\n',
      'X-GitHub-Recipient: reader\n',
      'X-GitHub-Reason: review_requested\n',
      'List-ID: example-org/widgets <widgets.example-org.github.com>\n',
      'List-Archive: https://github.com/example-org/widgets\n',
      'X-Auto-Response-Suppress: All\n',
      'X-GitHub-Recipient-Address: reader@example.net\n',
      '\n',
      '\n',
      '----==_mimepart_6729f1a5_3c\n',
      'Content-Type: text/plain;\n',
      ' charset=UTF-8\n',
      'Content-Transfer-Encoding: 7bit\n',
      '\n',
      '@rowanpike approved this pull request.\n',
      '\n',
      'Looks good once the backoff cap is configurable.\n',
      '\n',
      '-- \n',
      'Reply to this email directly or view it on GitHub:\n',
      'https://github.com/example-org/widgets/pull/212#pullrequestreview-9001\n',
      'You are receiving this because your review was requested.\n',
      '\n',
      'Message ID: <example-org/widgets/pull/212/review/9001@github.com>\n',
      '----==_mimepart_6729f1a5_3c\n',
      'Content-Type: text/html;\n',
      ' charset=UTF-8\n',
      'Content-Transfer-Encoding: 7bit\n',
      '\n',
      '<p></p><p><b>@rowanpike</b> approved this pull request.</p><p>Looks good once the backoff cap is configurable.</p>\n',
      '----==_mimepart_6729f1a5_3c--\n',
    ]),
    expected: {
      subject: 'Re: [example-org/widgets] Add a retry to the sprocket loader (PR #212)',
      fromName: 'Rowan Pike',
      textIncludes: [
        'approved this pull request',
        'Looks good once the backoff cap is configurable.',
        'pullrequestreview-9001',
      ],
      htmlOnly: false,
      attachments: [],
      headers: {
        'x-github-reason': 'review_requested',
        'x-github-sender': 'rowanpike',
        'list-id': 'example-org/widgets <widgets.example-org.github.com>',
      },
    },
  };
}

function buildReplyWithQuote(): Fixture {
  return {
    name: 'reply-quoted-history',
    covers: 'a plain-text reply with quoted history, In-Reply-To and References',
    raw: buildRaw([
      'From: Sam Okafor <sam@okafor.example>\n',
      'To: Alex Brandt <alex@brandt.example>\n',
      'Subject: Re: Re: Saturday plan\n',
      'Date: Sun, 01 Nov 2026 19:02:00 +0000\n',
      'Message-ID: <reply-3@okafor.example>\n',
      'In-Reply-To: <reply-2@brandt.example>\n',
      'References: <start-1@okafor.example> <reply-2@brandt.example>\n',
      'MIME-Version: 1.0\n',
      'Content-Type: text/plain; charset=utf-8; format=flowed\n',
      'Content-Transfer-Encoding: 8bit\n',
      '\n',
      'Ten o’clock works. I will bring the flask.\n',
      '\n',
      'On Sun, 1 Nov 2026 at 18:40, Alex Brandt <alex@brandt.example> wrote:\n',
      '> Shall we meet at the bridge at ten?\n',
      '>\n',
      '> On Sun, 1 Nov 2026 at 17:00, Sam Okafor <sam@okafor.example> wrote:\n',
      '>> Are we still on for the walk on Saturday?\n',
    ]),
    expected: {
      subject: 'Re: Re: Saturday plan',
      fromName: 'Sam Okafor',
      textIncludes: [
        'Ten o’clock works.',
        '> Shall we meet at the bridge at ten?',
        '>> Are we still on for the walk on Saturday?',
      ],
      htmlOnly: false,
      attachments: [],
      headers: { 'in-reply-to': '<reply-2@brandt.example>' },
    },
  };
}

// The CRLF before the next boundary belongs to the boundary, so the part's content ends without one.
const csvContent = 'date,item,amount\r\n2026-10-01,Seeds,4.50\r\n2026-10-02,Compost,12.00';

function buildNestedMixed(): Fixture {
  return {
    name: 'nested-mixed',
    covers: 'mixed > alternative > related with an inline image, plus a PDF and a CSV attachment',
    raw: buildRaw([
      'From: Priya Natarajan <priya@natarajan.example>\n',
      'To: reader@example.net\n',
      'Subject: Plot plan and costs\n',
      'Date: Sat, 31 Oct 2026 10:00:00 +0000\n',
      'Message-ID: <plan-1@natarajan.example>\n',
      'MIME-Version: 1.0\n',
      'Content-Type: multipart/mixed; boundary="outer"\n',
      '\n',
      'This is a multi-part message in MIME format.\n',
      '\n',
      '--outer\n',
      'Content-Type: multipart/alternative; boundary="middle"\n',
      '\n',
      '--middle\n',
      'Content-Type: text/plain; charset=UTF-8\n',
      '\n',
      'The plan for plot 14 is below, and the costs are in the CSV.\n',
      '\n',
      '--middle\n',
      'Content-Type: multipart/related; boundary="inner"\n',
      '\n',
      '--inner\n',
      'Content-Type: text/html; charset=UTF-8\n',
      '\n',
      '<p>The plan for plot 14 is below, and the costs are in the CSV.</p><img src="cid:plan@natarajan.example">\n',
      '--inner\n',
      'Content-Type: image/png\n',
      'Content-ID: <plan@natarajan.example>\n',
      'Content-Disposition: inline; filename="plan.png"\n',
      'Content-Transfer-Encoding: base64\n',
      '\n',
      buildBase64Lines(pngBytes),
      '--inner--\n',
      '\n',
      '--middle--\n',
      '\n',
      '--outer\n',
      'Content-Type: application/pdf\n',
      'Content-Disposition: attachment; filename="plot-14.pdf"\n',
      'Content-Transfer-Encoding: base64\n',
      '\n',
      buildBase64Lines(pdfBytes),
      '--outer\n',
      'Content-Type: text/csv; charset=UTF-8; name="costs.csv"\n',
      'Content-Disposition: attachment; filename="costs.csv"\n',
      '\n',
      csvContent,
      '\n--outer--\n',
    ]),
    expected: {
      subject: 'Plot plan and costs',
      fromName: 'Priya Natarajan',
      textIncludes: ['The plan for plot 14 is below, and the costs are in the CSV.'],
      htmlOnly: false,
      attachments: [
        { filename: 'plan.png', mimeType: 'image/png', inline: true, sha256: toSHA256(pngBytes) },
        {
          filename: 'plot-14.pdf',
          mimeType: 'application/pdf',
          inline: false,
          sha256: toSHA256(pdfBytes),
        },
        {
          filename: 'costs.csv',
          mimeType: 'text/csv',
          inline: false,
          sha256: toSHA256(new TextEncoder().encode(csvContent)),
        },
      ],
      headers: {},
    },
  };
}

function buildInlineImage(): Fixture {
  return {
    name: 'inline-image',
    covers: 'an HTML-only multipart/related message with a cid image and no filename',
    raw: buildRaw([
      'From: Garden Centre <shop@garden-centre.example>\n',
      'To: reader@example.net\n',
      'Subject: Your bulbs have shipped\n',
      'Date: Thu, 29 Oct 2026 15:00:00 +0000\n',
      'Message-ID: <ship-88@garden-centre.example>\n',
      'MIME-Version: 1.0\n',
      'Content-Type: multipart/related; boundary=rel; type="text/html"\n',
      '\n',
      '--rel\n',
      'Content-Type: text/html; charset=UTF-8\n',
      'Content-Transfer-Encoding: quoted-printable\n',
      '\n',
      '<img src=3D"cid:logo-1"><p>Your order of 40 tulip bulbs left our depot today=\n',
      '.</p>\n',
      '--rel\n',
      'Content-Type: image/png\n',
      'Content-ID: <logo-1>\n',
      'Content-Transfer-Encoding: base64\n',
      '\n',
      buildBase64Lines(pngBytes),
      '--rel--\n',
    ]),
    expected: {
      subject: 'Your bulbs have shipped',
      fromName: 'Garden Centre',
      textIncludes: ['Your order of 40 tulip bulbs left our depot today.'],
      htmlOnly: true,
      attachments: [
        { filename: null, mimeType: 'image/png', inline: true, sha256: toSHA256(pngBytes) },
      ],
      headers: {},
    },
  };
}

function buildBase64Text(): Fixture {
  const body = 'Héllo from the coast 🌊. The ferry leaves at 06:40, and the café opens at seven.\n';

  return {
    name: 'base64-text',
    covers: 'a base64 UTF-8 text body with an emoji and accented letters',
    raw: buildRaw([
      'From: Lena Fischer <lena@fischer.example>\n',
      'To: reader@example.net\n',
      'Subject: Ferry times\n',
      'Date: Fri, 30 Oct 2026 06:00:00 +0000\n',
      'Message-ID: <ferry@fischer.example>\n',
      'MIME-Version: 1.0\n',
      'Content-Type: text/plain; charset="utf-8"\n',
      'Content-Transfer-Encoding: base64\n',
      '\n',
      buildBase64Lines(new TextEncoder().encode(body)),
    ]),
    expected: {
      subject: 'Ferry times',
      fromName: 'Lena Fischer',
      textIncludes: ['Héllo from the coast 🌊.', 'the café opens at seven'],
      htmlOnly: false,
      attachments: [],
      headers: {},
    },
  };
}

function buildForwarded(): Fixture {
  return {
    name: 'forwarded-rfc822',
    covers: 'a forward that attaches the original as message/rfc822',
    raw: buildRaw([
      'From: Alex Brandt <alex@brandt.example>\n',
      'To: reader@example.net\n',
      'Subject: Fwd: Gate code\n',
      'Date: Sun, 01 Nov 2026 09:00:00 +0000\n',
      'Message-ID: <fwd@brandt.example>\n',
      'MIME-Version: 1.0\n',
      'Content-Type: multipart/mixed; boundary="fw"\n',
      '\n',
      '--fw\n',
      'Content-Type: text/plain; charset=UTF-8\n',
      '\n',
      'See the note from the warden below.\n',
      '--fw\n',
      'Content-Type: message/rfc822\n',
      'Content-Disposition: attachment; filename="gate-code.eml"\n',
      '\n',
      'From: Site Warden <warden@allotments.example>\n',
      'Subject: Gate code\n',
      'Content-Type: text/plain; charset=UTF-8\n',
      '\n',
      'The gate code changes to 4417 on Monday.\n',
      '--fw--\n',
    ]),
    expected: {
      subject: 'Fwd: Gate code',
      fromName: 'Alex Brandt',
      textIncludes: ['See the note from the warden below.'],
      htmlOnly: false,

      // The scorer leaves message/rfc822 parts out of the comparison and reports how each parser treats them.
      attachments: [],
      headers: {},
    },
  };
}

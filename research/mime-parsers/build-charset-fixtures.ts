// Every message here is invented: the names, addresses, repositories and amounts are made up.

import { buildBase64Lines } from './build-base64-lines.ts';
import { buildRaw } from './build-raw.ts';
import { pdfBytes } from './constants.ts';
import { toSHA256 } from './to-sha256.ts';
import type { Fixture } from './types.ts';

export function buildCharsetFixtures(): Fixture[] {
  return [
    buildLatin1(),
    buildWindows1252(),
    buildWindows1252LabelledLatin1(),
    buildShiftJIS(),
    buildISO2022JP(),
    buildEncodedHeaders(),
    buildUndeclared8Bit(),
    buildLFOnly(),
  ];
}

function buildLatin1(): Fixture {
  return {
    name: 'iso-8859-1',
    covers: 'an 8bit ISO-8859-1 body and a Q-encoded ISO-8859-1 subject',
    raw: buildRaw([
      'From: =?ISO-8859-1?Q?J=F6rg_M=FCller?= <joerg@mueller.example>\n',
      'To: reader@example.net\n',
      'Subject: =?ISO-8859-1?Q?Caf=E9_in_Z=FCrich?=\n',
      'Date: Mon, 26 Oct 2026 11:00:00 +0100\n',
      'Message-ID: <zh@mueller.example>\n',
      'MIME-Version: 1.0\n',
      'Content-Type: text/plain; charset=ISO-8859-1\n',
      'Content-Transfer-Encoding: 8bit\n',
      '\n',
      'Gr',
      Uint8Array.fromHex('fc'),
      'ezi! The caf',
      Uint8Array.fromHex('e9'),
      ' near the S',
      Uint8Array.fromHex('e9'),
      'e is na',
      Uint8Array.fromHex('ef'),
      've about prices: 4,50 ',
      Uint8Array.fromHex('a3'),
      ' for a tea.\n',
    ]),
    expected: {
      subject: 'Café in Zürich',
      fromName: 'Jörg Müller',
      textIncludes: ['Grüezi!', 'The café near the Sée is naïve about prices', '4,50 £ for a tea'],
      htmlOnly: false,
      attachments: [],
      headers: {},
    },
  };
}

function buildWindows1252(): Fixture {
  return {
    name: 'windows-1252',
    covers: 'a quoted-printable Windows-1252 body with curly quotes, an en dash and a euro sign',
    raw: buildRaw([
      'From: Office Desk <desk@office.example>\n',
      'To: reader@example.net\n',
      'Subject: Room booking\n',
      'Date: Tue, 27 Oct 2026 09:00:00 +0100\n',
      'Message-ID: <room@office.example>\n',
      'MIME-Version: 1.0\n',
      'Content-Type: text/plain; charset="Windows-1252"\n',
      'Content-Transfer-Encoding: quoted-printable\n',
      '\n',
      'The =93Harbour=94 room is booked 10:00=9611:00 at =8045 an hour.\n',
    ]),
    expected: {
      subject: 'Room booking',
      fromName: 'Office Desk',
      textIncludes: ['The “Harbour” room is booked 10:00–11:00 at €45 an hour.'],
      htmlOnly: false,
      attachments: [],
      headers: {},
    },
  };
}

function buildWindows1252LabelledLatin1(): Fixture {
  return {
    name: 'windows-1252-labelled-iso-8859-1',
    covers:
      'Windows-1252 bytes 0x80 to 0x9F in a part labelled ISO-8859-1, as many mail clients send',
    raw: buildRaw([
      'From: Old Client <old@client.example>\n',
      'To: reader@example.net\n',
      'Subject: Minutes\n',
      'Date: Tue, 27 Oct 2026 10:00:00 +0100\n',
      'Message-ID: <min@client.example>\n',
      'MIME-Version: 1.0\n',
      'Content-Type: text/plain; charset=iso-8859-1\n',
      'Content-Transfer-Encoding: 8bit\n',
      '\n',
      'We agreed the budget ',
      Uint8Array.fromHex('96'),
      ' ',
      Uint8Array.fromHex('80'),
      '300 ',
      Uint8Array.fromHex('96'),
      ' and it',
      Uint8Array.fromHex('92'),
      's final.\n',
    ]),
    expected: {
      subject: 'Minutes',
      fromName: 'Old Client',
      textIncludes: ['We agreed the budget – €300 – and it’s final.'],
      htmlOnly: false,
      attachments: [],
      headers: {},
    },
  };
}

// こんにちは、見積書です。 and 見積書, encoded with iconv -t SHIFT_JIS.
const shiftJISBody = Uint8Array.fromHex('82b182f182c982bf82cd81418ca990cf8f9182c582b78142');
const shiftJISQuote = Uint8Array.fromHex('8ca990cf8f91');

function buildShiftJIS(): Fixture {
  return {
    name: 'shift-jis',
    covers: 'an 8bit Shift_JIS body, a B-encoded Shift_JIS subject and an RFC 2231 UTF-8 filename',
    raw: buildRaw([
      `From: =?Shift_JIS?B?${shiftJISQuote.toBase64()}?= <quote@shop.example.jp>\n`,
      'To: reader@example.net\n',
      `Subject: =?Shift_JIS?B?${shiftJISQuote.toBase64()}?=\n`,
      'Date: Wed, 28 Oct 2026 09:00:00 +0900\n',
      'Message-ID: <q1@shop.example.jp>\n',
      'MIME-Version: 1.0\n',
      'Content-Type: multipart/mixed; boundary="sj"\n',
      '\n',
      '--sj\n',
      'Content-Type: text/plain; charset=Shift_JIS\n',
      'Content-Transfer-Encoding: 8bit\n',
      '\n',
      shiftJISBody,
      '\n',
      '--sj\n',
      'Content-Type: application/pdf\n',
      "Content-Disposition: attachment; filename*=UTF-8''%E8%A6%8B%E7%A9%8D.pdf\n",
      'Content-Transfer-Encoding: base64\n',
      '\n',
      buildBase64Lines(pdfBytes),
      '--sj--\n',
    ]),
    expected: {
      subject: '見積書',
      fromName: '見積書',
      textIncludes: ['こんにちは、見積書です。'],
      htmlOnly: false,
      attachments: [
        {
          filename: '見積.pdf',
          mimeType: 'application/pdf',
          inline: false,
          sha256: toSHA256(pdfBytes),
        },
      ],
      headers: {},
    },
  };
}

// こんにちは、会議の件です。 and 会議, encoded with iconv -t ISO-2022-JP.
const iso2022JPBody = Uint8Array.fromHex(
  '1b244224332473244b2441244f212232713544244e376f2447243921231b2842',
);

function buildISO2022JP(): Fixture {
  return {
    name: 'iso-2022-jp',
    covers: 'a 7bit ISO-2022-JP body and subject, the usual Japanese mail charset',
    raw: buildRaw([
      'From: Tanaka <tanaka@example.jp>\n',
      'To: reader@example.net\n',
      'Subject: =?ISO-2022-JP?B?GyRCMnE1RBsoQg==?=\n',
      'Date: Wed, 28 Oct 2026 10:00:00 +0900\n',
      'Message-ID: <k1@example.jp>\n',
      'MIME-Version: 1.0\n',
      'Content-Type: text/plain; charset=ISO-2022-JP\n',
      'Content-Transfer-Encoding: 7bit\n',
      '\n',
      iso2022JPBody,
      '\n',
    ]),
    expected: {
      subject: '会議',
      fromName: 'Tanaka',
      textIncludes: ['こんにちは、会議の件です。'],
      htmlOnly: false,
      attachments: [],
      headers: {},
    },
  };
}

function buildEncodedHeaders(): Fixture {
  return {
    name: 'rfc2047-headers',
    covers: 'RFC 2047 words in two charsets, folded across lines, with underscores and a filename',
    raw: buildRaw([
      'From: =?UTF-8?B?w4lsb2RpZSBEdXBvbnQ=?= <elodie@dupont.example>\n',
      'To: =?UTF-8?Q?Ren=C3=A9e?= <renee@example.net>\n',
      'Subject: =?UTF-8?Q?R=C3=A9union_de_l?= =?UTF-8?Q?=E2=80=99=C3=A9quipe?=\n',
      ' =?ISO-8859-1?Q?_=E0_14h?=\n',
      'Date: Thu, 29 Oct 2026 08:00:00 +0100\n',
      'Message-ID: <reu@dupont.example>\n',
      'MIME-Version: 1.0\n',
      'Content-Type: multipart/mixed; boundary=enc\n',
      '\n',
      '--enc\n',
      'Content-Type: text/plain; charset=UTF-8\n',
      'Content-Transfer-Encoding: quoted-printable\n',
      '\n',
      "L'ordre du jour est en pi=C3=A8ce jointe.\n",
      '--enc\n',
      'Content-Type: text/plain; charset=UTF-8; name="=?UTF-8?Q?ordre_du_jour_=C3=A9t=C3=A9.txt?="\n',
      'Content-Disposition: attachment; filename="=?UTF-8?Q?ordre_du_jour_=C3=A9t=C3=A9.txt?="\n',
      '\n',
      'Point 1\n',
      '--enc--\n',
    ]),
    expected: {
      subject: 'Réunion de l’équipe à 14h',
      fromName: 'Élodie Dupont',
      textIncludes: ["L'ordre du jour est en pièce jointe."],
      htmlOnly: false,
      attachments: [
        {
          filename: 'ordre du jour été.txt',
          mimeType: 'text/plain',
          inline: false,
          sha256: toSHA256(new TextEncoder().encode('Point 1')),
        },
      ],
      headers: {},
    },
  };
}

function buildUndeclared8Bit(): Fixture {
  return {
    name: 'undeclared-8bit-utf8',
    covers: 'raw UTF-8 in the subject and a body with no charset parameter',
    raw: buildRaw([
      'From: Zoë Kowalczyk <zoe@kowalczyk.example>\n',
      'To: reader@example.net\n',
      'Subject: Łódź trip — tickets\n',
      'Date: Fri, 30 Oct 2026 18:00:00 +0100\n',
      'Message-ID: <lodz@kowalczyk.example>\n',
      'MIME-Version: 1.0\n',
      'Content-Type: text/plain\n',
      '\n',
      'Tickets for Łódź are booked — 3 nights, żurek included.\n',
    ]),
    expected: {
      subject: 'Łódź trip — tickets',
      fromName: 'Zoë Kowalczyk',
      textIncludes: ['Tickets for Łódź are booked — 3 nights, żurek included.'],
      htmlOnly: false,
      attachments: [],
      headers: {},
    },
  };
}

function buildLFOnly(): Fixture {
  return {
    name: 'lf-line-endings',
    covers: 'a multipart message with LF line endings, as an mbox export stores it',
    raw: buildRaw(
      [
        'From: Mbox Export <export@example.net>\n',
        'To: reader@example.net\n',
        'Subject: Stored with LF\n',
        'Date: Sat, 31 Oct 2026 12:00:00 +0000\n',
        'Message-ID: <lf@example.net>\n',
        'MIME-Version: 1.0\n',
        'Content-Type: multipart/alternative; boundary="lf"\n',
        '\n',
        '--lf\n',
        'Content-Type: text/plain; charset=UTF-8\n',
        'Content-Transfer-Encoding: quoted-printable\n',
        '\n',
        'Line one stays apart from=\n',
        ' line two.\n',
        '--lf\n',
        'Content-Type: text/html; charset=UTF-8\n',
        '\n',
        '<p>Line one stays apart from line two.</p>\n',
        '--lf--\n',
      ],
      'lf',
    ),
    expected: {
      subject: 'Stored with LF',
      fromName: 'Mbox Export',
      textIncludes: ['Line one stays apart from line two.'],
      htmlOnly: false,
      attachments: [],
      headers: {},
    },
  };
}

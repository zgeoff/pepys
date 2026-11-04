// Every message here is invented: the names, addresses, repositories and amounts are made up.

import { buildBase64Lines } from './build-base64-lines.ts';
import { buildRaw } from './build-raw.ts';
import { pdfBytes } from './constants.ts';
import { toSHA256 } from './to-sha256.ts';
import type { Fixture } from './types.ts';

export function buildMalformedFixtures(): Fixture[] {
  return [
    buildWrongBoundary(),
    buildMissingBoundaryParameter(),
    buildMissingClosingBoundary(),
    buildTruncatedAttachment(),
    buildTruncatedHeaders(),
  ];
}

function buildWrongBoundary(): Fixture {
  return {
    name: 'malformed-wrong-boundary',
    covers: 'a declared boundary that the body never uses',
    raw: buildRaw([
      'From: Broken Sender <broken@sender.example>\n',
      'To: reader@example.net\n',
      'Subject: Boundary mismatch\n',
      'Date: Mon, 02 Nov 2026 10:00:00 +0000\n',
      'Message-ID: <bm@sender.example>\n',
      'MIME-Version: 1.0\n',
      'Content-Type: multipart/alternative; boundary="declared-one"\n',
      '\n',
      '--used-two\n',
      'Content-Type: text/plain; charset=UTF-8\n',
      '\n',
      'The meeting moves to Thursday.\n',
      '--used-two--\n',
    ]),
    expected: {
      subject: 'Boundary mismatch',
      fromName: 'Broken Sender',
      textIncludes: ['The meeting moves to Thursday.'],
      htmlOnly: false,
      attachments: [],
      headers: {},
    },
  };
}

function buildMissingBoundaryParameter(): Fixture {
  return {
    name: 'malformed-no-boundary-parameter',
    covers: 'multipart/mixed with no boundary parameter',
    raw: buildRaw([
      'From: Broken Sender <broken@sender.example>\n',
      'To: reader@example.net\n',
      'Subject: No boundary\n',
      'Date: Mon, 02 Nov 2026 10:05:00 +0000\n',
      'Message-ID: <nb@sender.example>\n',
      'MIME-Version: 1.0\n',
      'Content-Type: multipart/mixed\n',
      '\n',
      'The keys are under the blue pot.\n',
    ]),
    expected: {
      subject: 'No boundary',
      fromName: 'Broken Sender',
      textIncludes: ['The keys are under the blue pot.'],
      htmlOnly: false,
      attachments: [],
      headers: {},
    },
  };
}

function buildMissingClosingBoundary(): Fixture {
  return {
    name: 'malformed-no-closing-boundary',
    covers: 'a multipart message whose closing boundary is missing',
    raw: buildRaw([
      'From: Broken Sender <broken@sender.example>\n',
      'To: reader@example.net\n',
      'Subject: No closing boundary\n',
      'Date: Mon, 02 Nov 2026 10:10:00 +0000\n',
      'Message-ID: <nc@sender.example>\n',
      'MIME-Version: 1.0\n',
      'Content-Type: multipart/alternative; boundary="open"\n',
      '\n',
      '--open\n',
      'Content-Type: text/plain; charset=UTF-8\n',
      '\n',
      'Bring the ladder on Friday.\n',
      '--open\n',
      'Content-Type: text/html; charset=UTF-8\n',
      '\n',
      '<p>Bring the ladder on Friday.</p>\n',
    ]),
    expected: {
      subject: 'No closing boundary',
      fromName: 'Broken Sender',
      textIncludes: ['Bring the ladder on Friday.'],
      htmlOnly: false,
      attachments: [],
      headers: {},
    },
  };
}

// 40 base64 characters decode to 30 bytes, and the 41st is a partial group that decodes to none.
const truncatedBase64Length = 41;
const truncatedBytes = 30;

function buildTruncatedAttachment(): Fixture {
  const base64 = buildBase64Lines(pdfBytes);

  return {
    name: 'truncated-mid-attachment',
    covers: 'a message cut off in the middle of a base64 attachment',
    raw: buildRaw([
      'From: Scanner <scanner@office.example>\n',
      'To: reader@example.net\n',
      'Subject: Scan 0042\n',
      'Date: Tue, 03 Nov 2026 14:00:00 +0000\n',
      'Message-ID: <scan42@office.example>\n',
      'MIME-Version: 1.0\n',
      'Content-Type: multipart/mixed; boundary="scan"\n',
      '\n',
      '--scan\n',
      'Content-Type: text/plain; charset=UTF-8\n',
      '\n',
      'Your scan of 3 pages is attached.\n',
      '--scan\n',
      'Content-Type: application/pdf\n',
      'Content-Disposition: attachment; filename="scan-0042.pdf"\n',
      'Content-Transfer-Encoding: base64\n',
      '\n',
      base64.slice(0, truncatedBase64Length),
    ]),
    expected: {
      subject: 'Scan 0042',
      fromName: 'Scanner',
      textIncludes: ['Your scan of 3 pages is attached.'],
      htmlOnly: false,
      attachments: [
        {
          filename: 'scan-0042.pdf',
          mimeType: 'application/pdf',
          inline: false,
          sha256: toSHA256(pdfBytes.slice(0, truncatedBytes)),
        },
      ],
      headers: {},
    },
  };
}

function buildTruncatedHeaders(): Fixture {
  return {
    name: 'truncated-in-headers',
    covers: 'a message cut off inside its header block, with no body',
    raw: buildRaw([
      'From: Cut Short <cut@short.example>\n',
      'To: reader@example.net\n',
      'Subject: Half a messa',
    ]),
    expected: {
      subject: 'Half a messa',
      fromName: 'Cut Short',
      textIncludes: [],
      htmlOnly: false,
      attachments: [],
      headers: {},
    },
  };
}

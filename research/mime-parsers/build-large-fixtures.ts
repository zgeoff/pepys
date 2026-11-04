// Every message here is invented: the names, addresses and amounts are made up.

import { buildBase64Lines } from './build-base64-lines.ts';
import { buildRaw } from './build-raw.ts';
import { toSHA256 } from './to-sha256.ts';
import type { Fixture } from './types.ts';

export function buildLargeFixtures(): Fixture[] {
  return [buildLargeNewsletter(), buildLargeAttachment()];
}

const largeNewsletterItemCount = 1500;

function buildLargeNewsletter(): Fixture {
  const items = Array.from(
    { length: largeNewsletterItemCount },
    (_, index) =>
      `<tr><td class="item"><a href="https://deals.example/i/${index}">Item ${index}</a></td><td>£${(index % 90) + 10}.99</td></tr>`,
  );

  const html = `<html><body><h1>Weekly deals</h1><table>${items.join('')}</table><p>Prices end on Sunday.</p></body></html>`;

  return {
    name: 'large-html-newsletter',
    covers: `an HTML-only newsletter of ${largeNewsletterItemCount} table rows in base64, about 170 KB`,
    raw: buildRaw([
      'From: Deals <deals@deals.example>\n',
      'To: reader@example.net\n',
      'Subject: Weekly deals\n',
      'Date: Mon, 02 Nov 2026 06:00:00 +0000\n',
      'Message-ID: <weekly@deals.example>\n',
      'MIME-Version: 1.0\n',
      'Content-Type: text/html; charset=UTF-8\n',
      'Content-Transfer-Encoding: base64\n',
      '\n',
      buildBase64Lines(new TextEncoder().encode(html)),
    ]),
    expected: {
      subject: 'Weekly deals',
      fromName: 'Deals',
      textIncludes: ['Weekly deals', 'Item 1499', 'Prices end on Sunday.'],
      htmlOnly: true,
      attachments: [],
      headers: {},
    },
  };
}

const largeAttachmentBytes = 5 * 1024 * 1024;

function buildLargeAttachment(): Fixture {
  const content = buildPseudoRandomBytes(largeAttachmentBytes);

  return {
    name: 'large-attachment',
    covers: 'a short text body with a 5 MiB base64 attachment',
    raw: buildRaw([
      'From: Camera Roll <camera@photos.example>\n',
      'To: reader@example.net\n',
      'Subject: Holiday video\n',
      'Date: Tue, 03 Nov 2026 20:00:00 +0000\n',
      'Message-ID: <video@photos.example>\n',
      'MIME-Version: 1.0\n',
      'Content-Type: multipart/mixed; boundary="big"\n',
      '\n',
      '--big\n',
      'Content-Type: text/plain; charset=UTF-8\n',
      '\n',
      'The clip from the beach is attached.\n',
      '--big\n',
      'Content-Type: video/mp4\n',
      'Content-Disposition: attachment; filename="beach.mp4"\n',
      'Content-Transfer-Encoding: base64\n',
      '\n',
      buildBase64Lines(content),
      '--big--\n',
    ]),
    expected: {
      subject: 'Holiday video',
      fromName: 'Camera Roll',
      textIncludes: ['The clip from the beach is attached.'],
      htmlOnly: false,
      attachments: [
        { filename: 'beach.mp4', mimeType: 'video/mp4', inline: false, sha256: toSHA256(content) },
      ],
      headers: {},
    },
  };
}

// A fixed linear congruential sequence, so every run builds the same bytes.
function buildPseudoRandomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);

  let state = 0x25_45_f4_91;

  for (let index = 0; index < length; index++) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    out[index] = state >>> 24;
  }

  return out;
}

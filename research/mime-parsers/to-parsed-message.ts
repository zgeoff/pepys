import type { ParsedMail } from 'mailparser';
import type { LibraryOutput } from './run-message-parser.ts';
import { toSHA256 } from './to-sha256.ts';

export interface ParsedAttachment {
  filename: string | null;
  mimeType: string;
  inline: boolean;
  sha256: string;
  sizeBytes: number;
}

export interface ParsedMessage {
  subject: string | null;
  fromName: string | null;
  text: string | null;
  html: string | null;
  attachments: ParsedAttachment[];

  // Each header line as the parser kept it, keyed by its lowercase name.
  headerLines: Record<string, string>;
}

export function toParsedMessage(output: LibraryOutput): ParsedMessage {
  if (output.library === 'mailparser') {
    return toParsedMail(output.mail);
  }

  const email = output.email;

  return {
    subject: email.subject ?? null,
    fromName: email.from === undefined ? null : email.from.name,
    text: email.text ?? output.convertedText,
    html: email.html ?? null,
    attachments: email.attachments.map((attachment) => {
      const content = toBytes(attachment.content);

      return {
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        inline: attachment.related === true || attachment.disposition === 'inline',
        sha256: toSHA256(content),
        sizeBytes: content.length,
      };
    }),
    headerLines: Object.fromEntries(email.headerLines.map((header) => [header.key, header.line])),
  };
}

function toParsedMail(mail: ParsedMail): ParsedMessage {
  return {
    subject: mail.subject ?? null,
    fromName: mail.from?.value[0]?.name ?? null,
    text: mail.text ?? null,
    html: typeof mail.html === 'string' ? mail.html : null,
    attachments: mail.attachments.map((attachment) => ({
      filename: attachment.filename ?? null,
      mimeType: attachment.contentType,
      inline: attachment.related === true || attachment.contentDisposition === 'inline',
      sha256: toSHA256(attachment.content),
      sizeBytes: attachment.content.length,
    })),
    headerLines: Object.fromEntries(mail.headerLines.map((header) => [header.key, header.line])),
  };
}

function toBytes(content: ArrayBuffer | Uint8Array | string): Uint8Array {
  if (typeof content === 'string') {
    return new TextEncoder().encode(content);
  }

  return content instanceof Uint8Array ? content : new Uint8Array(content);
}

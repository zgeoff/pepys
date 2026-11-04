import { convert } from 'html-to-text';
import { simpleParser } from 'mailparser';
import type { ParsedMail } from 'mailparser';
import PostalMime from 'postal-mime';
import type { Email } from 'postal-mime';

export type ParserName = 'postal-mime' | 'postal-mime+html-to-text' | 'mailparser';

export const parserNames: ParserName[] = ['postal-mime', 'postal-mime+html-to-text', 'mailparser'];

export type LibraryOutput =
  | { library: 'postal-mime'; email: Email; convertedText: string | null }
  | { library: 'mailparser'; mail: ParsedMail };

// The library call alone, which the runner times. Both parsers run with their default options.
export async function runMessageParser(
  parser: ParserName,
  raw: Uint8Array,
): Promise<LibraryOutput> {
  if (parser === 'mailparser') {
    const mail = await simpleParser(Buffer.from(raw));

    return { library: 'mailparser', mail };
  }

  const email = await PostalMime.parse(raw);

  const html =
    parser === 'postal-mime+html-to-text' && email.text === undefined ? email.html : undefined;

  // The same converter and depth limit that mailparser applies to an HTML-only message.
  const convertedText = html === undefined ? null : convert(html, { limits: { maxDepth: 200 } });

  return { library: 'postal-mime', email, convertedText };
}

import type { ParsedAttachment, ParsedMessage } from './to-parsed-message.ts';
import type { Expected, ExpectedAttachment } from './types.ts';

export interface FixtureScore {
  subjectMatches: boolean;
  fromNameMatches: boolean;
  textMissing: boolean;
  htmlPresent: boolean;
  phrasesFound: number;
  phrasesTotal: number;
  missingPhrases: string[];
  leaks: string[];
  attachmentsMatched: number;
  attachmentsExpected: number;
  attachmentProblems: string[];
  headersMatched: number;
  headersExpected: number;
  rfc822: { attachment: boolean; textInlined: boolean };
}

// Signs that MIME syntax or a wrong charset reached the plain text.
const leakMarkers: { name: string; pattern: RegExp }[] = [
  { name: 'replacement character', pattern: /�/u },
  { name: 'UTF-8 read as Latin-1', pattern: /Ã|â€|Â£/u },
  { name: 'Shift_JIS read as Latin-1', pattern: /‚±|‚ñ/u },
  { name: 'quoted-printable escape', pattern: /=[0-9A-F]{2}|=\r?\n/u },
  { name: 'encoded word', pattern: /=\?[^?]+\?[BQbq]\?/u },
  { name: 'part header', pattern: /^Content-(?:Type|Transfer-Encoding|Disposition):/imu },
  { name: 'boundary line', pattern: /^--[^\s-]\S*$|^----==_/mu },
  { name: 'HTML tag', pattern: /<(?:p|div|table|html|body|img)\b/iu },
  { name: 'base64 run', pattern: /^[A-Za-z0-9+/]{60,}={0,2}$/mu },
];

export function buildFixtureScore(expected: Expected, parsed: ParsedMessage): FixtureScore {
  const text = parsed.text ?? '';
  const normalizedText = toComparable(text);

  const missingPhrases = expected.textIncludes.filter(
    (phrase) => !normalizedText.includes(toComparable(phrase)),
  );

  const attachments = parsed.attachments.filter(
    (attachment) => attachment.mimeType !== 'message/rfc822',
  );

  const attachmentProblems = collectAttachmentProblems(expected.attachments, attachments);
  const headerEntries = Object.entries(expected.headers);

  return {
    subjectMatches: parsed.subject === expected.subject,
    fromNameMatches: parsed.fromName === expected.fromName,
    textMissing: parsed.text === null || parsed.text.trim() === '',
    htmlPresent: parsed.html !== null,
    phrasesFound: expected.textIncludes.length - missingPhrases.length,
    phrasesTotal: expected.textIncludes.length,
    missingPhrases,
    leaks: collectLeaks(text),
    attachmentsMatched:
      expected.attachments.length - countMissing(expected.attachments, attachments),
    attachmentsExpected: expected.attachments.length,
    attachmentProblems,
    headersMatched: headerEntries.filter(
      ([key, value]) => toHeaderValue(parsed.headerLines[key]) === value,
    ).length,
    headersExpected: headerEntries.length,
    rfc822: {
      attachment: parsed.attachments.some((attachment) => attachment.mimeType === 'message/rfc822'),
      textInlined: normalizedText.includes(toComparable('The gate code changes to 4417')),
    },
  };
}

// Whitespace and case differ between converters without changing what a reader sees.
function toComparable(text: string): string {
  return text.replaceAll(/\s+/gu, ' ').trim().toLowerCase();
}

export function collectLeaks(text: string): string[] {
  return leakMarkers.filter((marker) => marker.pattern.test(text)).map((marker) => marker.name);
}

function collectAttachmentProblems(
  expected: ExpectedAttachment[],
  parsed: ParsedAttachment[],
): string[] {
  const problems: string[] = [];

  for (const want of expected) {
    const match = findAttachment(want, parsed);

    if (match === undefined) {
      problems.push(`missing ${want.filename ?? want.mimeType}`);
      continue;
    }

    if (match.sha256 !== want.sha256) {
      problems.push(
        `content differs for ${want.filename ?? want.mimeType} (${match.sizeBytes} bytes)`,
      );
    }

    if (match.inline !== want.inline) {
      problems.push(
        `${want.filename ?? want.mimeType} marked ${match.inline ? 'inline' : 'attached'}`,
      );
    }
  }

  const extra = parsed.length - expected.length;

  if (extra > 0) {
    problems.push(
      `${extra} extra: ${parsed.map((attachment) => attachment.filename ?? attachment.mimeType).join(', ')}`,
    );
  }

  return problems;
}

function findAttachment(
  want: ExpectedAttachment,
  parsed: ParsedAttachment[],
): ParsedAttachment | undefined {
  return parsed.find(
    (attachment) => attachment.filename === want.filename && attachment.mimeType === want.mimeType,
  );
}

function countMissing(expected: ExpectedAttachment[], parsed: ParsedAttachment[]): number {
  return expected.filter((want) => {
    const match = findAttachment(want, parsed);

    return match === undefined || match.sha256 !== want.sha256 || match.inline !== want.inline;
  }).length;
}

function toHeaderValue(line: string | undefined): string | null {
  if (line === undefined) {
    return null;
  }

  return line
    .replace(/^[^:]+:/u, '')
    .replaceAll(/\r?\n[ \t]+/gu, ' ')
    .trim();
}

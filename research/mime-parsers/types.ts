export interface ExpectedAttachment {
  filename: string | null;
  mimeType: string;
  inline: boolean;

  // null when the part is cut short, so its content has no known hash.
  sha256: string | null;
}

export interface Expected {
  subject: string;
  fromName: string | null;

  // The phrases a reader of the plain text must find, decoded.
  textIncludes: string[];
  htmlOnly: boolean;
  attachments: ExpectedAttachment[];
  headers: Record<string, string>;
}

export interface Fixture {
  name: string;
  covers: string;
  raw: Uint8Array;
  expected: Expected;
}

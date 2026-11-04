// A minimal PDF and a valid 1x1 PNG, shared by the fixtures that attach them.
export const pdfBytes = new TextEncoder().encode(
  '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n',
);

export const pngBytes = Uint8Array.fromHex(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5d3c1d40000000049454e44ae426082',
);

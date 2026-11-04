export function toMediaType(contentType: string): string {
  const [mediaType = ''] = contentType.split(';');

  return mediaType.trim().toLowerCase();
}

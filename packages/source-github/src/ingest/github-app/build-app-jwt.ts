import { createSign } from 'node:crypto';

// The JWT a GitHub App signs to call the API as itself. GitHub refuses an `exp` more than ten
// minutes after `iat`, and sets `iat` a minute back for clocks that drift. A private key kept in
// one line of an env file holds `\n` in place of each line break.
export function buildAppJWT(appID: string, privateKey: string, nowMs: number): string {
  const nowSeconds = Math.floor(nowMs / 1000);
  const header = toSegment({ alg: 'RS256', typ: 'JWT' });
  const claims = toSegment({ iat: nowSeconds - 60, exp: nowSeconds + 540, iss: appID });

  const signature = createSign('RSA-SHA256')
    .update(`${header}.${claims}`)
    .sign(privateKey.replaceAll(String.raw`\n`, '\n'), 'base64url');

  return `${header}.${claims}.${signature}`;
}

function toSegment(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

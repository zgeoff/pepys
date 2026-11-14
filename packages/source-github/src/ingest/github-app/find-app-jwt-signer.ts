import { buildAppJWT } from './build-app-jwt.ts';

// The function that signs the App's JWT, or undefined when the key cannot sign. GitHub refuses a JWT
// ten minutes after its `iat`, and a pull can run for longer, so each call takes a JWT of its own.
export function findAppJWTSigner(
  env: Readonly<Record<string, string>>,
  now: () => number,
): (() => string) | undefined {
  const appID = env['PEPYS_GITHUB_APP_ID'] ?? '';
  const privateKey = env['PEPYS_GITHUB_APP_PRIVATE_KEY'] ?? '';

  try {
    // a JWT of time 0 shows that the key signs, and reads no clock
    buildAppJWT(appID, privateKey, 0);
  } catch {
    return undefined;
  }

  return () => buildAppJWT(appID, privateKey, now());
}

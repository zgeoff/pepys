import { buildAppJWT } from './build-app-jwt.ts';

// The App's JWT from the pull's env, or undefined when the private key cannot sign.
export function findAppJWT(
  env: Readonly<Record<string, string>>,
  nowMs: number,
): string | undefined {
  try {
    return buildAppJWT(
      env['PEPYS_GITHUB_APP_ID'] ?? '',
      env['PEPYS_GITHUB_APP_PRIVATE_KEY'] ?? '',
      nowMs,
    );
  } catch {
    return undefined;
  }
}

import type { Logger } from '@pepys/kit';
import { z } from 'zod';
import { requestGithubAPI } from './request-github-api.ts';

// `not-installed`: the App has no installation on the repository, so it can read nothing there.
export type InstallationToken =
  | { kind: 'token'; token: string }
  | { kind: 'not-installed' }
  | { kind: 'failed'; status: number };

const installationSchema = z.looseObject({ id: z.number().int() });
const accessTokenSchema = z.looseObject({ token: z.string().min(1) });

// The token of the App's installation on one repository, `owner/name`, from the App's JWT.
export async function readInstallationToken(
  repository: string,
  appJWT: string,
  log: Logger,
): Promise<InstallationToken> {
  const installation = await requestGithubAPI(`/repos/${repository}/installation`, appJWT, log);

  if (installation.status === 404) {
    return { kind: 'not-installed' };
  }

  const parsedInstallation = installationSchema.safeParse(installation.body);

  if (installation.status !== 200 || !parsedInstallation.success) {
    return { kind: 'failed', status: installation.status };
  }

  const created = await requestGithubAPI(
    `/app/installations/${parsedInstallation.data.id}/access_tokens`,
    appJWT,
    log,
    'POST',
  );

  const parsedToken = accessTokenSchema.safeParse(created.body);

  if (created.status !== 201 || !parsedToken.success) {
    return { kind: 'failed', status: created.status };
  }

  return { kind: 'token', token: parsedToken.data.token };
}

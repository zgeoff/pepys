import type { PasskeyID } from '@zgeoff/mcp-auth';
import { openAuthAdmin } from './open-auth-admin.ts';
import { PROCESS_IO } from './process-io.ts';
import type { ProcessIO } from './process-io.ts';

export type PasskeysAction =
  | { readonly kind: 'list' }
  | { readonly kind: 'enroll'; readonly reset: boolean }
  | { readonly kind: 'remove'; readonly id: PasskeyID };

// The authorization server's database, and the command that prefixes every
// message, such as `passkeys`.
interface PasskeysTarget {
  readonly dbPath: string;
  readonly command: string;
}

export async function runPasskeys(
  action: PasskeysAction,
  target: PasskeysTarget,
  io: Pick<ProcessIO, 'print' | 'printError' | 'setExitCode'> = PROCESS_IO,
): Promise<void> {
  const opened = await openAuthAdmin(target.dbPath);

  const passkeys = opened.admin.passkeys;

  try {
    if (action.kind === 'enroll') {
      if (action.reset) {
        await passkeys.reset();

        io.print(
          'Removed every passkey and enrollment token and ended every browser sign-in. Grants stay.',
        );
      }

      const token = await passkeys.createEnrollmentToken();

      io.print(`Enrollment token: ${token}`);

      io.print(
        "It enrolls one passkey and expires soon. Open /enroll on the server's public URL in your browser and type it there.",
      );

      return;
    }

    const enrolled = await passkeys.list();

    if (action.kind === 'remove') {
      if (!enrolled.some((passkey) => passkey.id === action.id)) {
        io.printError(`${target.command} remove: no passkey has the ID '${action.id}'`);
        io.setExitCode(1);

        return;
      }

      await passkeys.remove(action.id);

      io.print(`Removed passkey ${action.id} and ended every browser sign-in`);

      return;
    }

    if (enrolled.length === 0) {
      io.print(`No passkeys. Enroll one with: ${target.command} enroll`);

      return;
    }

    for (const passkey of enrolled) {
      io.print(
        `${passkey.id}  enrolled ${passkey.createdAt}  last used ${passkey.lastUsedAt ?? 'never'}`,
      );
    }
  } finally {
    await opened.close();
  }
}

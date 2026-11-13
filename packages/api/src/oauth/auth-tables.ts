import type { MCPAuthTables } from '@zgeoff/mcp-auth';

// The tables pepys kept its passkeys and enrollment tokens in before the auth
// core, so they stay where they are.
export const AUTH_TABLES: MCPAuthTables = {
  passkey: 'pepys_passkey',
  enrollmentToken: 'pepys_enrollment_token',
};

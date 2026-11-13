import { GATEWAY_PATHS } from '../constants.ts';
import { PASSKEY_SCRIPT } from './passkey-script.ts';
import { toHTMLText } from './to-html-text.ts';
import { toScriptJSON } from './to-script-json.ts';

interface LoginPageView {
  // The signed authorization query the page posts back.
  readonly oauthQuery: string;
  readonly clientName: string;
  readonly redirectURI: string;

  // The WebAuthn request options for this page's challenge, or null when
  // no passkey is enrolled, so there is nothing to sign in with.
  readonly options: unknown;
  readonly error: string | null;
}

export function renderLoginPage(view: LoginPageView): string {
  const error = view.error === null ? '' : `<p class="error">${toHTMLText(view.error)}</p>`;

  const signIn =
    view.options === null
      ? `<p class="error">No passkey is enrolled, so nobody can sign in. On the host that runs the API, run its <code>passkeys enroll</code> command, then follow what it prints.</p>`
      : `<script type="application/json" id="pepys-passkey">${toScriptJSON({ mode: 'get', options: view.options })}</script>
<form method="post" action="${GATEWAY_PATHS.browser.login}" id="pepys-passkey-form">
<input type="hidden" name="oauth_query" value="${toHTMLText(view.oauthQuery)}">
<input type="hidden" name="credential" value="">
<button type="button" id="pepys-passkey-start" autofocus>Sign in with a passkey</button>
</form>
<p id="pepys-passkey-status" class="error" role="status"></p>
<script>${PASSKEY_SCRIPT.source}</script>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in to pepys</title>
<style>
body { font-family: system-ui, sans-serif; max-width: 32rem; margin: 3rem auto; padding: 0 1rem; line-height: 1.5; }
.error { color: #b00020; }
code { word-break: break-all; }
button { font: inherit; }
</style>
</head>
<body>
<h1>Sign in to pepys</h1>
<p><strong>${toHTMLText(view.clientName)}</strong> wants access to your pepys data.</p>
<p>After approval it returns to <code>${toHTMLText(view.redirectURI)}</code>.</p>
<p>Sign in with your passkey. You choose what to allow on the next page.</p>
${error}
${signIn}
</body>
</html>
`;
}

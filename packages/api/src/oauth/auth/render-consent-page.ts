import { GATEWAY_PATHS } from '../constants.ts';
import type { GrantScope } from '../constants.ts';
import { toHTMLText } from './to-html-text.ts';

interface ConsentPageView {
  // The signed authorization query the page posts back.
  readonly oauthQuery: string;
  readonly clientName: string;
  readonly redirectURI: string;
  readonly scopes: readonly GrantScope[];
}

const SCOPE_LABELS: Readonly<Record<GrantScope, string>> = {
  read: 'Read your entities, their links, and every query the deployment serves',
};

// Only reading starts granted; every scope that lets the client act starts
// withheld.
const GRANTED_BY_DEFAULT: ReadonlySet<GrantScope> = new Set<GrantScope>(['read']);

export function renderConsentPage(view: ConsentPageView): string {
  const scopeRows = view.scopes
    .map((scope) => {
      const checked = GRANTED_BY_DEFAULT.has(scope) ? ' checked' : '';

      return `<label><input type="checkbox" name="scope" value="${scope}"${checked}> ${toHTMLText(SCOPE_LABELS[scope])}</label>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Choose what to allow</title>
<style>
body { font-family: system-ui, sans-serif; max-width: 32rem; margin: 3rem auto; padding: 0 1rem; line-height: 1.5; }
label { display: block; margin: 0.25rem 0; }
code { word-break: break-all; }
button { font: inherit; margin-right: 0.5rem; }
</style>
</head>
<body>
<h1>Choose what to allow</h1>
<p><strong>${toHTMLText(view.clientName)}</strong> returns to <code>${toHTMLText(view.redirectURI)}</code> with the access you allow here.</p>
<form method="post" action="${GATEWAY_PATHS.browser.consent}">
<input type="hidden" name="oauth_query" value="${toHTMLText(view.oauthQuery)}">
<fieldset>
<legend>Allow it to</legend>
${scopeRows}
</fieldset>
<p><button type="submit" name="decision" value="approve">Allow</button><button type="submit" name="decision" value="deny">Deny</button></p>
</form>
</body>
</html>
`;
}

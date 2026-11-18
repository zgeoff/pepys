interface UnitFacts {
  bun: string;
  bin: string;
  issuer: string;
  audience: string;
  ingestURL: string | null;

  // the settings that `install` copies from its own environment, by variable name
  copied: Readonly<Record<string, string>>;
}

// The systemd user unit. Systemd splits a word on white space, and reads `%` and `\` in a value.
export function renderUnit(facts: UnitFacts): string {
  const variables = {
    ...facts.copied,
    PEPYS_FORWARDER_ISSUER: facts.issuer,
    PEPYS_FORWARDER_AUDIENCE: facts.audience,
    ...(facts.ingestURL === null ? {} : { PEPYS_FORWARDER_INGEST_URL: facts.ingestURL }),
  };

  const environment = Object.entries(variables).map(
    ([name, value]) => `Environment=${quoteWord(`${name}=${value}`)}`,
  );

  return [
    '[Service]',
    `ExecStart=${quoteWord(facts.bun)} ${quoteWord(facts.bin)} run`,
    ...environment,
    'Restart=always',
    'RestartSec=5',
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n');
}

function quoteWord(word: string): string {
  const escaped = word
    .replaceAll('\\', String.raw`\\`)
    .replaceAll('%', '%%')
    .replaceAll('"', String.raw`\"`);

  return /[\s"'\\$;]/u.test(word) ? `"${escaped}"` : escaped;
}

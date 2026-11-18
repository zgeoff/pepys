import { expect, test } from 'bun:test';
import { renderUnit } from './render-unit.ts';

test('#renderUnit writes the unit of the design', () => {
  const unit = renderUnit({
    bun: '/home/owner/.bun/bin/bun',
    bin: '/home/owner/.bun/install/global/node_modules/@pepys/source-telemetry/src/forwarder-bin.ts',
    issuer: 'study-pc',
    audience: 'forwarder.pepys.example',
    ingestURL: 'https://ingest.tailnet.example',
    copied: { PEPYS_FORWARDER_PORT: '4999' },
  });

  expect(unit).toBe(`[Service]
ExecStart=/home/owner/.bun/bin/bun /home/owner/.bun/install/global/node_modules/@pepys/source-telemetry/src/forwarder-bin.ts run
Environment=PEPYS_FORWARDER_PORT=4999
Environment=PEPYS_FORWARDER_ISSUER=study-pc
Environment=PEPYS_FORWARDER_AUDIENCE=forwarder.pepys.example
Environment=PEPYS_FORWARDER_INGEST_URL=https://ingest.tailnet.example
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`);
});

test('#renderUnit sets no ingest URL when it has none', () => {
  const unit = renderUnit({
    bun: '/bun',
    bin: '/bin.ts',
    issuer: 'a',
    audience: 'b',
    ingestURL: null,
    copied: {},
  });

  expect(unit).not.toContain('PEPYS_FORWARDER_INGEST_URL');
});

test('#renderUnit quotes a path with a space and doubles a percent sign', () => {
  const unit = renderUnit({
    bun: '/opt/my bun/bun',
    bin: '/bin.ts',
    issuer: 'a',
    audience: '100%',
    ingestURL: null,
    copied: { PEPYS_FORWARDER_SPOOL_DIR: '/var/my spool' },
  });

  expect(unit).toContain('ExecStart="/opt/my bun/bun" /bin.ts run');
  expect(unit).toContain('Environment="PEPYS_FORWARDER_SPOOL_DIR=/var/my spool"');
  expect(unit).toContain('Environment=PEPYS_FORWARDER_AUDIENCE=100%%');
});

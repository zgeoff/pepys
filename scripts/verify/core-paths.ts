// What every verify feature holds, so a change to any of it flags them all. When you can't tell
// whether a path reaches a feature, add it here: a missed feature costs more than a journey.
export const corePaths = {
  // Package folders that every journey runs whole, each with the workspace packages it depends on.
  packages: [
    // the fact envelope, IDs, plug-in definitions and logger that ingest, the API and every
    // consumer use
    'packages/kit',

    // the consumer manifest and the shutdown that ingest and the API start with
    'packages/schema',

    // the core oRPC contract that every query of the CLI calls
    'packages/contract',

    // the store driver that every API read goes through
    'packages/kysely-turso',
  ],

  // Globs that skip the dependency walk. They hold the part of a package that every journey runs,
  // and each feature names the other parts its journey reaches.
  globs: [
    // ingest: its start, the receive route that every send goes through, the fact log, the blob
    // store, and the pulls and other sender proofs, which no journey can be traced to
    'packages/ingest/src/*.ts',
    'packages/ingest/src/{blob-store,config,fact-log,pull,receive,serve,utils}/**',
    'packages/ingest/src/sender-proof/{fake,none}/**',

    // the API: its start, the oRPC router and the store reader that every query reads through
    'packages/api/src/*.ts',
    'packages/api/src/{app,client,config,serve,store-reader}/**',
    'packages/api/src/queries/*.ts',
    'packages/api/src/queries/entity-kinds/**',

    // `pepys build`, which `bun run test:e2e:prepare` runs to compile each consumer the host runs
    'packages/cli/src/{bin,parse-cli-arguments,run-cli}.ts',
    'packages/cli/src/build/**',
    'packages/cli/src/utils/**',

    // the e2e deployment, and the stack that `bun verify up` starts it on
    'packages/cli/e2e/fixtures/{collect-lagging-consumers,e2e-deployment,e2e-read-consumers,e2e-secrets,read-lagging-consumers,start-e2e-stack}.ts',

    // the ledger plug-in of the e2e deployment, whose facts the stack seeds at every start
    'packages/testing/src/ledger/**',

    // the host, which applies every fact, and the Garage and s2-lite stack
    'crates/host/**',
    'stack/**',
  ],
} as const;

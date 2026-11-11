import { defineConsumer, defineTable } from '@pepys/kit';
import { deploymentFamily } from './families/deployment-family.ts';
import { refFamily } from './families/ref-family.ts';

// One row per signal that reported a commit to an environment, with the earliest time it did.
export const githubDeployConsumer = defineConsumer({
  name: 'github_deploy',
  entry: new URL('consumers/github-deploy.ts', import.meta.url),
  input: { mode: 'fact', streams: [refFamily.stream, deploymentFamily.stream] },
  tables: {
    github_deploy: defineTable({
      columns: {
        // `github:deploy:<repository ID>:<environment>:<signal>:<sha>`, and `:<target>` after it
        // for a row with a target, so two targets of one commit do not share a row
        id: { kind: 'entityID' },
        repository_id: { kind: 'entityID' },
        environment: { kind: 'text' },
        target: { kind: 'text', nullable: true },
        sha: { kind: 'text' },
        signal: { kind: 'text' },
        deployed_at: { kind: 'timestamp' },
      },
      primaryKey: ['id'],
      indexes: [{ columns: ['repository_id', 'environment'] }],
    }),
  },
  entityViews: [
    {
      table: 'github_deploy',
      kind: 'github:deploy',
      id: 'id',
      title: 'sha',
      url: null,
      actor: null,
      updatedAt: 'deployed_at',
    },
  ],
  reads: ['github_deploy'],
  links: [],
});

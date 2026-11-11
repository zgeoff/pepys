import { z } from 'zod';

// `pepys build` writes the checked values into the glue of each consumer, so a changed pattern is a
// new version of `github_deploy`. A tag with one more part, `<pattern>/<target>`, names a target.
export const githubSettings = {
  schema: z.object({
    deployTagPattern: z
      .string()
      .includes('<environment>')
      .refine((pattern) => pattern.split('<environment>').length === 2, {
        message: 'the pattern holds <environment> once',
      }),
  }),
  defaults: { deployTagPattern: 'deployed/<environment>' },
};

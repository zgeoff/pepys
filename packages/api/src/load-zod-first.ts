import { z } from 'zod';

// Bun's bundler drops the init of zod for `import * as z from 'zod/v4'` in the MCP SDK when another
// import reaches zod through `import()`. Using zod here runs its init first; see it with
// `bun build --compile` on an API entry, then `passkeys`: without this line, `new ZodLazy` throws.
z.config({});

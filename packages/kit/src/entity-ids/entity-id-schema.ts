import { z } from 'zod';
import { isEntityID } from './is-entity-id.ts';

// A refine, never a transform: an MCP schema is the JSON Schema of a zod schema, and a transform
// has none. The type guard brands what the parse returns.
export const entityIDSchema = z.string().refine(isEntityID, 'not an entity ID');

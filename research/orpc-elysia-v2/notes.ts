import { z } from 'zod';

export const noteSchema = z.object({ id: z.string(), title: z.string(), words: z.number().int() });

export type Note = z.infer<typeof noteSchema>;

// The fixture both oRPC majors serve: one invented note per ID.
export const notes: ReadonlyMap<string, Note> = new Map([
  ['demo:note:1', { id: 'demo:note:1', title: 'Moor at the quay', words: 4 }],
]);

export const noteInputSchema = z.object({
  id: z
    .string()
    .regex(/^demo:note:\d+$/u)
    .describe('A note ID, such as demo:note:1'),
});

export type NoteInput = z.infer<typeof noteInputSchema>;

export const getNoteDescription = 'Get one note by its ID.';

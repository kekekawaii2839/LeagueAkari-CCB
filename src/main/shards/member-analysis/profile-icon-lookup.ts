import { z } from 'zod'

// Private worker/main contract. Never part of a renderer IPC response.
export const ProfileIconLookupSchema = z
  .object({
    identity: z.string().regex(/^[a-f0-9]{64}$/),
    serverId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    puuid: z.string().min(1).max(256)
  })
  .strict()
export type ProfileIconLookup = z.infer<typeof ProfileIconLookupSchema>

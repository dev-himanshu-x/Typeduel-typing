import { z } from "zod";
import { MAX_INPUT_LEN, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "./protocol";
import { MAX_WORDS } from "./words";

/* Runtime validation for everything the server receives. Server-only: the client
   imports types/constants from ./protocol so zod stays out of the browser bundle. */

export const IdentitySchema = z.object({
  playerId: z.uuid(),
  name: z.string().trim().min(1).max(16),
});

const roomCodeRegex = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

export const RoomCreatePayload = z.object({}).strict();
export const RoomJoinPayload = z
  .object({ code: z.string().trim().toUpperCase().regex(roomCodeRegex) })
  .strict();
export const RoomReadyPayload = z.object({ ready: z.boolean() }).strict();
export const RoomConfigPayload = z.object({ durationSec: z.number().int().min(1).max(600) }).strict();
export const RoomLeavePayload = z.object({}).strict();
export const TimeSyncPayload = z.object({ clientSentMs: z.number().finite() }).strict();

export const RaceProgressPayload = z
  .object({
    seq: z.number().int().min(0),
    wordIndex: z.number().int().min(0).max(MAX_WORDS - 1),
    charIndex: z.number().int().min(0).max(MAX_INPUT_LEN),
    wpm: z.number().finite().min(0).max(1000),
    raw: z.number().finite().min(0).max(1000),
    acc: z.number().finite().min(0).max(100),
    errors: z.number().int().min(0).max(100_000),
  })
  .strict();

export const RaceFinishPayload = z
  .object({
    typed: z.array(z.string().max(MAX_INPUT_LEN)).min(1).max(MAX_WORDS),
    activeIndex: z.number().int().min(0).max(MAX_WORDS - 1),
    correctKeys: z.number().int().min(0),
    totalKeys: z.number().int().min(0),
  })
  .strict()
  .refine((p) => p.correctKeys <= p.totalKeys, "correctKeys must be <= totalKeys");

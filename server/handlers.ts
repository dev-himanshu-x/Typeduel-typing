import type { Server, Socket } from "socket.io";
import type { ZodType } from "zod";
import { EVENTS, type Ack, type ErrorCode, type Identity } from "../shared/protocol";
import {
  IdentitySchema,
  RaceFinishPayload,
  RaceProgressPayload,
  RoomConfigPayload,
  RoomCreatePayload,
  RoomJoinPayload,
  RoomLeavePayload,
  RoomReadyPayload,
  TimeSyncPayload,
} from "../shared/schemas";
import { GameError, type RoomMachine } from "./room-machine";

const RATE_WINDOW_MS = 10_000;
const RATE_MAX_EVENTS = 40;
// Progress streams at ~7/s per player; allow generous headroom.
const PROGRESS_MAX_EVENTS = 300;

/** Handshake guard: every socket must present a valid guest identity. */
export function registerAuth(io: Server): void {
  io.use((socket, next) => {
    const parsed = IdentitySchema.safeParse(socket.handshake.auth);
    if (!parsed.success) {
      const err = new Error("UNAUTHORIZED") as Error & { data?: unknown };
      err.data = {
        code: "UNAUTHORIZED" satisfies ErrorCode,
        message: "auth must be { playerId: uuid, name: 1-16 chars }",
      };
      next(err);
      return;
    }
    socket.data.identity = parsed.data;
    next();
  });
}

export function registerHandlers(io: Server, machine: RoomMachine): void {
  registerAuth(io);

  io.on("connection", (socket) => {
    const identity = socket.data.identity as Identity;
    const allow = createRateLimiter(RATE_MAX_EVENTS);
    const allowProgress = createRateLimiter(PROGRESS_MAX_EVENTS);

    // Wraps a handler with: ack normalisation, rate limiting, validation, error mapping.
    const on = <T>(event: string, schema: ZodType<T>, run: (payload: T) => unknown) => {
      socket.on(event, (...args: unknown[]) => {
        const ackFn = args.find((a): a is (r: Ack<unknown>) => void => typeof a === "function");
        const raw = typeof args[0] === "function" ? undefined : args[0];
        const reply = (res: Ack<unknown>) => {
          try {
            ackFn?.(res);
          } catch (err) {
            console.error(`[${event}] ack callback threw:`, err);
          }
        };

        if (!allow()) {
          reply(fail("RATE_LIMITED", "Too many requests"));
          return;
        }
        const parsed = schema.safeParse(raw ?? {});
        if (!parsed.success) {
          const field = parsed.error.issues[0]?.path[0];
          reply(
            fail(field === "code" ? "INVALID_CODE" : "INVALID_PAYLOAD", "Invalid request payload"),
          );
          return;
        }
        try {
          reply({ ok: true, data: run(parsed.data) ?? {} });
        } catch (err) {
          if (err instanceof GameError) reply(fail(err.code, err.message));
          else {
            console.error(`[${event}] unexpected error:`, err);
            reply(fail("INTERNAL", "Internal error"));
          }
        }
      });
    };

    on(EVENTS.roomCreate, RoomCreatePayload, () => ({ room: machine.create(socket, identity) }));
    on(EVENTS.roomJoin, RoomJoinPayload, ({ code }) => ({
      room: machine.join(socket, identity, code),
    }));
    on(EVENTS.roomReady, RoomReadyPayload, ({ ready }) => machine.setReady(identity, ready));
    on(EVENTS.roomConfig, RoomConfigPayload, ({ durationSec }) => machine.configure(identity, durationSec));
    on(EVENTS.roomLeave, RoomLeavePayload, () => machine.leave(identity));
    on(EVENTS.timeSync, TimeSyncPayload, ({ clientSentMs }) => ({
      clientSentMs,
      serverNowMs: Date.now(),
    }));

    on(EVENTS.raceFinish, RaceFinishPayload, (payload) => machine.finish(identity, payload));

    // Fire-and-forget stream: no ack, invalid or excess reports are silently dropped.
    socket.on(EVENTS.raceProgress, (raw: unknown) => {
      if (!allowProgress()) return;
      const parsed = RaceProgressPayload.safeParse(raw);
      if (!parsed.success) return;
      try {
        machine.progress(socket, identity, parsed.data);
      } catch (err) {
        console.error("[race:progress] unexpected error:", err);
      }
    });

    socket.on("error", (err) => console.error("[socket] error:", err));
    socket.on("disconnect", () => {
      try {
        machine.onDisconnect(socket, identity);
      } catch (err) {
        console.error("[socket] disconnect handler failed:", err);
      }
    });

    try {
      machine.onConnect(socket, identity); // re-seat a returning player
    } catch (err) {
      console.error("[socket] connect handler failed:", err);
    }
  });
}

function fail(code: ErrorCode, message: string): Ack<never> {
  return { ok: false, error: { code, message } };
}

/** Sliding-window limiter: `max` events per RATE_WINDOW_MS per socket. */
function createRateLimiter(max: number): () => boolean {
  const stamps: number[] = [];
  return () => {
    const now = Date.now();
    while (stamps.length && now - stamps[0] > RATE_WINDOW_MS) stamps.shift();
    if (stamps.length >= max) return false;
    stamps.push(now);
    return true;
  };
}

export type { Socket };

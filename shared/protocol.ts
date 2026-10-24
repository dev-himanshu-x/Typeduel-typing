/* ---------------------------------------------------------------------------
   Wire protocol shared by the Socket.IO server and (later) the Next.js client.
   --------------------------------------------------------------------------- */

export const EVENTS = {
  // client -> server (ack-based)
  roomCreate: "room:create",
  roomJoin: "room:join",
  roomReady: "room:ready",
  roomLeave: "room:leave",
  timeSync: "time:sync",
  raceProgress: "race:progress", // also server -> client (opponent only)
  raceFinish: "race:finish",
  roomConfig: "room:config",
  // server -> client
  roomState: "room:state",
  raceCountdown: "race:countdown",
  raceStart: "race:start",
  raceResult: "race:result",
  raceResumed: "race:resumed",
  raceTimeUp: "race:timeup",
  playerPresence: "player:presence",
  matchSaved: "match:saved",
  matchSaveFailed: "match:save_failed",
  sessionReplaced: "session:replaced",
} as const;

/** No O/0/I/1 so codes survive being read aloud. */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 6;
export const MAX_PLAYERS = 2;
/** Race lengths offered in the UI (seconds). */
export const DURATIONS = [15, 30, 60, 120] as const;
export const DEFAULT_DURATION_SEC = 30;
export const COUNTDOWN_MS = 3000;

/* ---- Handshake identity (socket.handshake.auth) ------------------------- */

export interface Identity {
  playerId: string; // uuid
  name: string; // 1-16 chars
}

/* ---- Client -> server payloads (validated by shared/schemas.ts) --------- */

export const MAX_INPUT_LEN = 32;

export interface RaceProgress {
  seq: number;
  wordIndex: number;
  charIndex: number;
  wpm: number;
  raw: number;
  acc: number;
  /** Wrong keystrokes so far (corrected or not). */
  errors: number;
}

export interface OpponentProgress extends RaceProgress {
  playerId: string;
}

export interface RaceFinishPayload {
  typed: string[]; // final input for every word, in order ('' for words never reached)
  /** Index of the word being typed when time ran out (its input is not committed). */
  activeIndex: number;
  correctKeys: number;
  totalKeys: number;
}

/* ---- Server -> client payloads ------------------------------------------ */

export type RoomStatus = "waiting" | "countdown" | "in_progress" | "finished";

export interface PublicPlayer {
  id: string;
  name: string;
  ready: boolean;
  connected: boolean;
}

export interface MatchResultPlayer {
  playerId: string;
  name: string;
  wpm: number;
  raw: number;
  acc: number;
  /** Wrong keystrokes (corrected or not): totalKeys - correctKeys. */
  errors: number;
  /** 0-100; per-second WPM stability. 0 when there is too little data (series.length < 2). */
  consistency: number;
  /** WPM at the end of each second of the race (index 0 = second 1). */
  series: number[];
  elapsedMs: number | null;
  place: 1 | 2;
}

export interface MatchResult {
  /** Identifies this race; also the primary key of the persisted match. */
  matchId: string;
  winnerId: string | null;
  reason: "finished" | "forfeit";
  players: MatchResultPlayer[];
}

/** Never contains the seed: that is only revealed through `race:countdown`. */
export interface RoomSnapshot {
  code: string;
  status: RoomStatus;
  hostId: string;
  wordCount: number;
  /** Race length in seconds (host-configurable between races). */
  durationSec: number;
  players: PublicPlayer[];
  startsAt: number | null;
  /** Set while a player is disconnected mid-race: input is frozen until they return or `until` passes. */
  paused: { until: number; graceMs: number; playerIds: string[] } | null;
  result: MatchResult | null;
}

export interface CountdownPayload {
  seed: number;
  durationSec: number;
  bankVersion: number;
  wordCount: number;
  checksum: number;
  serverNowMs: number;
  startsAt: number;
}

/** The race clock moved forward by the time spent paused; clients shift their local clock to match. */
export interface RaceResumedPayload {
  startsAt: number;
  pausedMs: number;
}

export interface RaceStartPayload {
  startsAt: number;
}

export interface MatchSavePayload {
  matchId: string;
}

export interface PresencePayload {
  playerId: string;
  connected: boolean;
  graceMs?: number;
}

/* ---- Acks ---------------------------------------------------------------- */

export type ErrorCode =
  | "UNAUTHORIZED"
  | "INVALID_PAYLOAD"
  | "INVALID_CODE"
  | "ROOM_NOT_FOUND"
  | "ROOM_FULL"
  | "ROOM_NOT_JOINABLE"
  | "ALREADY_IN_ROOM"
  | "NOT_IN_ROOM"
  | "BAD_STATE"
  | "RATE_LIMITED"
  | "INTERNAL";

export type Ack<T = Record<string, never>> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode; message: string } };

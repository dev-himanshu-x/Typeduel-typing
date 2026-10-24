import { randomInt } from "node:crypto";
import {
  MAX_PLAYERS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  type MatchResult,
  type RaceProgress,
  type RoomSnapshot,
  type RoomStatus,
} from "../shared/protocol";

export interface Player {
  id: string;
  name: string;
  socketId: string | null;
  ready: boolean;
  connected: boolean;
  /** Latest accepted progress report for the current race. */
  progress: RaceProgress | null;
  /** Latest reported WPM per elapsed second (index = floor(seconds since GO)). */
  secWpm: Record<number, number>;
  /** Pending removal / forfeit after a disconnect. */
  graceTimer: NodeJS.Timeout | null;
  /** Epoch ms when the grace period ends (set together with graceTimer). */
  graceUntil: number | null;
}

export interface Submission {
  wpm: number;
  raw: number;
  acc: number;
  errors: number;
  tally: { allCorrect: number; correctWord: number; incorrect: number; extra: number; missed: number };
}

export interface Room {
  code: string;
  status: RoomStatus;
  hostId: string;
  players: Player[]; // at most MAX_PLAYERS
  wordCount: number;
  /** Race length in seconds; `wordCount` is derived from it. */
  durationSec: number;
  bankVersion: number;
  /** Only set between countdown start and the next reset; never put in a RoomSnapshot. */
  matchId: string | null;
  seed: number | null;
  startsAt: number | null;
  /** Set when a player drops mid-race; the race clock and input are frozen until everyone is back. */
  pausedAt: number | null;
  /** When the race clock hits zero (shifted by pauses). */
  endsAt: number | null;
  /** Time is up and we are collecting final results from the players. */
  closing: boolean;
  submissions: Map<string, Submission>;
  endTimer: NodeJS.Timeout | null;
  settleTimer: NodeJS.Timeout | null;
  result: MatchResult | null;
  countdownTimer: NodeJS.Timeout | null;
}

export class RoomStore {
  private rooms = new Map<string, Room>();
  private roomByPlayer = new Map<string, string>();

  get(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  roomOf(playerId: string): Room | undefined {
    const code = this.roomByPlayer.get(playerId);
    return code === undefined ? undefined : this.rooms.get(code);
  }

  get size(): number {
    return this.rooms.size;
  }

  create(host: Player, durationSec: number, wordCount: number, bankVersion: number): Room {
    const room: Room = {
      code: this.generateCode(),
      status: "waiting",
      hostId: host.id,
      players: [host],
      wordCount,
      durationSec,
      bankVersion,
      matchId: null,
      seed: null,
      startsAt: null,
      pausedAt: null,
      endsAt: null,
      closing: false,
      submissions: new Map(),
      endTimer: null,
      settleTimer: null,
      result: null,
      countdownTimer: null,
    };
    this.rooms.set(room.code, room);
    this.roomByPlayer.set(host.id, room.code);
    return room;
  }

  addPlayer(room: Room, player: Player): void {
    if (room.players.length >= MAX_PLAYERS) throw new Error("room full");
    room.players.push(player);
    this.roomByPlayer.set(player.id, room.code);
  }

  removePlayer(room: Room, playerId: string): void {
    const player = room.players.find((p) => p.id === playerId);
    if (player?.graceTimer) clearTimeout(player.graceTimer);
    room.players = room.players.filter((p) => p.id !== playerId);
    if (this.roomByPlayer.get(playerId) === room.code) this.roomByPlayer.delete(playerId);
    if (room.hostId === playerId && room.players[0]) room.hostId = room.players[0].id;
    if (room.players.length === 0) this.delete(room);
  }

  delete(room: Room): void {
    if (room.countdownTimer) clearTimeout(room.countdownTimer);
    if (room.endTimer) clearTimeout(room.endTimer);
    if (room.settleTimer) clearTimeout(room.settleTimer);
    for (const p of room.players) {
      if (p.graceTimer) clearTimeout(p.graceTimer);
      if (this.roomByPlayer.get(p.id) === room.code) this.roomByPlayer.delete(p.id);
    }
    this.rooms.delete(room.code);
  }

  clear(): void {
    for (const room of [...this.rooms.values()]) this.delete(room);
  }

  /** Unique 6-char code from an unambiguous alphabet, using a CSPRNG. */
  private generateCode(): string {
    for (let attempt = 0; attempt < 100; attempt++) {
      let code = "";
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    throw new Error("could not allocate a unique room code");
  }
}

function pausedInfo(room: Room): RoomSnapshot["paused"] {
  if (room.status !== "in_progress" || room.pausedAt === null) return null;
  const away = room.players.filter((p) => !p.connected);
  const deadlines = away.map((p) => p.graceUntil).filter((n): n is number => n !== null);
  if (away.length === 0 || deadlines.length === 0) return null;
  const until = Math.min(...deadlines);
  return { until, graceMs: until - room.pausedAt, playerIds: away.map((p) => p.id) };
}

export function snapshot(room: Room): RoomSnapshot {
  return {
    code: room.code,
    status: room.status,
    hostId: room.hostId,
    wordCount: room.wordCount,
    durationSec: room.durationSec,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      ready: p.ready,
      connected: p.connected,
    })),
    startsAt: room.startsAt,
    paused: pausedInfo(room),
    result: room.result,
  };
}

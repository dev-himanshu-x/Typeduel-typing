import { randomInt, randomUUID } from "node:crypto";
import type { Server, Socket } from "socket.io";
import {
  COUNTDOWN_MS,
  EVENTS,
  MAX_PLAYERS,
  DEFAULT_DURATION_SEC,
  DURATIONS,
  type CountdownPayload,
  type ErrorCode,
  type Identity,
  type MatchResult,
  type MatchResultPlayer,
  type PresencePayload,
  type RaceFinishPayload,
  type RaceProgress,
  type RaceResumedPayload,
  type RaceStartPayload,
  type RoomSnapshot,
} from "../shared/protocol";
import { consistency, round2, scoreTimed } from "../shared/scoring";
import { BANK_VERSION, generateWords, wordsChecksum, wordsForDuration } from "../shared/words";
import type { MatchRecord, MatchRecorder } from "./match-recorder";
import { RoomStore, snapshot, type Player, type Room } from "./room-store";

export class GameError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface MachineOptions {
  countdownMs: number;
  /** How long a disconnected player keeps their seat outside a running race. */
  graceLobbyMs: number;
  /** How long a disconnected player keeps their seat during a race before forfeiting. */
  graceRaceMs: number;
  /** Finish reports implying more than this are rejected as implausible. */
  maxWpm: number;
  /** Race lengths a host may choose (seconds). Tests use tiny values. */
  allowedDurations: readonly number[];
  defaultDurationSec: number;
  /** After time is up, how long to wait for both players' final results before using streamed numbers. */
  submitWaitMs: number;
  /** Clients may submit slightly before the server's own end time (clock drift). */
  submitEarlyToleranceMs: number;
}

export const DEFAULT_MACHINE_OPTIONS: MachineOptions = {
  countdownMs: COUNTDOWN_MS,
  graceLobbyMs: 30_000,
  graceRaceMs: 10_000,
  maxWpm: 500,
  allowedDurations: DURATIONS,
  defaultDurationSec: DEFAULT_DURATION_SEC,
  submitWaitMs: 2_500,
  submitEarlyToleranceMs: 1_500,
};

/**
 * Room lifecycle: waiting -> countdown -> in_progress -> finished (-> countdown on rematch).
 * The server owns every transition; clients only request ready/leave.
 */
export class RoomMachine {
  constructor(
    private readonly io: Server,
    private readonly store: RoomStore,
    private readonly opts: MachineOptions = DEFAULT_MACHINE_OPTIONS,
    /** Optional: when set, every finished match is persisted in the background. */
    private readonly recorder?: MatchRecorder,
  ) {}

  /* ---- Requests from sockets ------------------------------------------- */

  /** Called for every new authenticated socket: re-seats a returning player. */
  onConnect(socket: Socket, identity: Identity): void {
    const room = this.store.roomOf(identity.playerId);
    const player = room?.players.find((p) => p.id === identity.playerId);
    if (!room || !player) return;

    const wasConnected = player.connected;
    this.attach(room, player, socket);
    if (!wasConnected) this.emitPresence(room, { playerId: player.id, connected: true });
    this.maybeResume(room); // everyone is back: unfreeze the race
    this.emitState(room);
    // Late/returning client: hand it the seed so it can rebuild the same text.
    if (room.seed !== null && (room.status === "countdown" || room.status === "in_progress")) {
      socket.emit(EVENTS.raceCountdown, this.countdownPayload(room));
      if (room.status === "in_progress") {
        socket.emit(EVENTS.raceStart, this.startPayload(room));
      }
    }
  }

  create(socket: Socket, identity: Identity): RoomSnapshot {
    if (this.store.roomOf(identity.playerId)) {
      throw new GameError("ALREADY_IN_ROOM", "Leave your current room first");
    }
    const durationSec = this.opts.defaultDurationSec;
    const room = this.store.create(this.newPlayer(identity), durationSec, wordsForDuration(durationSec), BANK_VERSION);
    this.attach(room, room.players[0], socket);
    this.emitState(room);
    return snapshot(room);
  }

  join(socket: Socket, identity: Identity, code: string): RoomSnapshot {
    const room = this.store.get(code);
    if (!room) throw new GameError("ROOM_NOT_FOUND", "No room with that code");

    const current = this.store.roomOf(identity.playerId);
    if (current && current !== room) {
      throw new GameError("ALREADY_IN_ROOM", "Leave your current room first");
    }

    const existing = room.players.find((p) => p.id === identity.playerId);
    if (existing) {
      // Same player re-joining their own seat (e.g. second tab): take it over.
      this.attach(room, existing, socket);
      this.maybeResume(room);
      this.emitState(room);
      return snapshot(room);
    }

    if (room.players.length >= MAX_PLAYERS) throw new GameError("ROOM_FULL", "Room is full");
    if (room.status === "countdown" || room.status === "in_progress") {
      throw new GameError("ROOM_NOT_JOINABLE", "A race is already underway");
    }
    if (room.status === "finished") this.resetToWaiting(room);

    const player = this.newPlayer(identity);
    this.store.addPlayer(room, player);
    this.attach(room, player, socket);
    this.emitState(room);
    return snapshot(room);
  }

  setReady(identity: Identity, ready: boolean): void {
    const room = this.requireRoom(identity.playerId);
    const player = this.requirePlayer(room, identity.playerId);

    if (room.status === "in_progress") {
      throw new GameError("BAD_STATE", "Cannot change ready state during a race");
    }

    if (room.status === "countdown") {
      if (!ready) this.cancelCountdown(room); // resets everyone's ready flag
      this.emitState(room);
      return;
    }

    player.ready = ready;
    if (this.canStart(room)) this.startCountdown(room);
    else this.emitState(room);
  }

  leave(identity: Identity): void {
    const room = this.requireRoom(identity.playerId);
    this.removeFromRoom(room, identity.playerId);
  }

  onDisconnect(socket: Socket, identity: Identity): void {
    const room = this.store.roomOf(identity.playerId);
    const player = room?.players.find((p) => p.id === identity.playerId);
    // Ignore sockets that were replaced by a newer connection of the same player.
    if (!room || !player || player.socketId !== socket.id) return;

    player.socketId = null;
    player.connected = false;
    player.ready = false;
    if (room.status === "countdown") this.cancelCountdown(room);

    const graceMs = room.status === "in_progress" ? this.opts.graceRaceMs : this.opts.graceLobbyMs;
    this.emitPresence(room, { playerId: player.id, connected: false, graceMs });
    this.emitState(room);

    if (player.graceTimer) clearTimeout(player.graceTimer);
    player.graceUntil = Date.now() + graceMs;
    player.graceTimer = setTimeout(() => this.expire(room.code, player.id), graceMs);
    // Mid-race: freeze the race for everyone until the player is back (or the grace period forfeits it).
    if (room.status === "in_progress" && !room.closing && room.pausedAt === null) {
      room.pausedAt = Date.now();
      if (room.endTimer) clearTimeout(room.endTimer); // the clock is frozen too
      room.endTimer = null;
    }
    this.emitState(room); // now carries `paused` with the reconnection deadline
    if (room.closing) this.maybeSettle(room); // time was already up: don't wait for someone who left
  }

  /** Host picks the race length between races. */
  configure(identity: Identity, durationSec: number): void {
    const room = this.requireRoom(identity.playerId);
    if (room.hostId !== identity.playerId) throw new GameError("BAD_STATE", "Only the host can change the race length");
    if (room.status !== "waiting" && room.status !== "finished") {
      throw new GameError("BAD_STATE", "The race length can't change during a race");
    }
    if (!this.opts.allowedDurations.includes(durationSec)) {
      throw new GameError("INVALID_PAYLOAD", "Unsupported race length");
    }
    room.durationSec = durationSec;
    room.wordCount = wordsForDuration(durationSec);
    // Changing the rules invalidates any ready-ups.
    for (const p of room.players) p.ready = false;
    this.emitState(room);
  }

  /** Relay a throttled progress report to the opponent. Out-of-order or invalid reports are dropped. */
  progress(socket: Socket, identity: Identity, report: RaceProgress): void {
    const room = this.store.roomOf(identity.playerId);
    const player = room?.players.find((p) => p.id === identity.playerId);
    if (!room || !player || room.status !== "in_progress" || room.startsAt === null) return;
    if (room.pausedAt !== null || room.closing || Date.now() < room.startsAt) return;
    if (player.progress && report.seq <= player.progress.seq) return;
    if (report.wordIndex >= room.wordCount) return;

    player.progress = report;
    player.secWpm[Math.floor((Date.now() - room.startsAt) / 1000)] = report.wpm;
    socket.to(room.code).emit(EVENTS.raceProgress, { playerId: player.id, ...report });
  }

  /**
   * A player's final input when their clock hits zero. Stats are recomputed here from that input;
   * the race settles once everyone has submitted (or a short wait after the server's own end time).
   */
  finish(identity: Identity, payload: RaceFinishPayload): void {
    const room = this.requireRoom(identity.playerId);
    this.requirePlayer(room, identity.playerId);
    if (room.status !== "in_progress" || room.seed === null || room.startsAt === null || room.endsAt === null) {
      throw new GameError("BAD_STATE", "No race in progress");
    }
    if (room.pausedAt !== null) throw new GameError("BAD_STATE", "The race is paused while a player reconnects");
    if (Date.now() < room.endsAt - this.opts.submitEarlyToleranceMs) {
      throw new GameError("BAD_STATE", "The race is not over yet");
    }
    if (room.submissions.has(identity.playerId)) throw new GameError("BAD_STATE", "Result already submitted");
    if (payload.typed.length !== room.wordCount || payload.activeIndex >= room.wordCount) {
      throw new GameError("INVALID_PAYLOAD", "Result does not match this race");
    }
    if (payload.typed.slice(payload.activeIndex + 1).some((t) => t !== "")) {
      throw new GameError("INVALID_PAYLOAD", "Input after the active word");
    }

    const words = generateWords(room.seed, room.wordCount, room.bankVersion);
    const stats = scoreTimed(words, payload.typed, payload.activeIndex, payload.correctKeys, payload.totalKeys, room.durationSec * 1000);
    if (stats.raw > this.opts.maxWpm) throw new GameError("INVALID_PAYLOAD", "Implausible typing speed");

    room.submissions.set(identity.playerId, {
      wpm: stats.wpm,
      raw: stats.raw,
      acc: stats.acc,
      errors: payload.totalKeys - payload.correctKeys,
      tally: stats.tally,
    });
    this.maybeSettle(room);
  }

  /** Drop every room and timer (server shutdown / tests). */
  dispose(): void {
    this.store.clear();
  }

  /* ---- Transitions ------------------------------------------------------ */

  private canStart(room: Room): boolean {
    return (
      (room.status === "waiting" || room.status === "finished") &&
      room.players.length === MAX_PLAYERS &&
      room.players.every((p) => p.ready && p.connected)
    );
  }

  private startCountdown(room: Room): void {
    room.result = null;
    for (const p of room.players) this.clearRaceData(p);
    room.seed = randomInt(0, 2 ** 32);
    room.matchId = randomUUID();
    room.pausedAt = null;
    room.closing = false;
    room.submissions.clear();
    room.endsAt = null;
    room.status = "countdown";
    room.startsAt = Date.now() + this.opts.countdownMs;

    // Seed (and so the text) is revealed to both players in the same broadcast.
    this.io.to(room.code).emit(EVENTS.raceCountdown, this.countdownPayload(room));
    this.emitState(room);

    room.countdownTimer = setTimeout(
      () => this.safely(() => this.beginRace(room)),
      Math.max(0, room.startsAt - Date.now()),
    );
  }

  private beginRace(room: Room): void {
    // The room may have been cancelled or deleted while the timer was pending.
    if (this.store.get(room.code) !== room || room.status !== "countdown") return;
    room.countdownTimer = null;
    room.status = "in_progress";
    room.endsAt = (room.startsAt ?? Date.now()) + room.durationSec * 1000;
    this.armEndTimer(room);
    this.io.to(room.code).emit(EVENTS.raceStart, this.startPayload(room));
    this.emitState(room);
  }

  /** (Re)schedule the end of the race relative to `endsAt`; called at GO and again after a pause. */
  private armEndTimer(room: Room): void {
    if (room.endTimer) clearTimeout(room.endTimer);
    room.endTimer = null;
    if (room.endsAt === null) return;
    room.endTimer = setTimeout(() => this.safely(() => this.timeUp(room)), Math.max(0, room.endsAt - Date.now()));
  }

  /** The clock hit zero: ask for final results and settle once they are in (or after a short wait). */
  private timeUp(room: Room): void {
    if (this.store.get(room.code) !== room || room.status !== "in_progress" || room.pausedAt !== null) return;
    room.endTimer = null;
    room.closing = true;
    this.io.to(room.code).emit(EVENTS.raceTimeUp);
    room.settleTimer = setTimeout(() => this.safely(() => this.settle(room)), this.opts.submitWaitMs);
    this.maybeSettle(room);
  }

  private maybeSettle(room: Room): void {
    if (!room.closing || room.status !== "in_progress") return;
    const waiting = room.players.some((p) => p.connected && !room.submissions.has(p.id));
    if (!waiting) this.settle(room);
  }

  /** Winner = higher WPM; ties go to accuracy, then it is a draw. */
  private settle(room: Room): void {
    if (room.status !== "in_progress") return;
    if (room.settleTimer) clearTimeout(room.settleTimer);
    room.settleTimer = null;
    const durationMs = room.durationSec * 1000;
    const seconds = room.durationSec;

    const entries: MatchResultPlayer[] = room.players.map((p) => {
      const sub = room.submissions.get(p.id);
      if (!sub) return this.entryFromProgress(p, 2, seconds); // never submitted: last streamed numbers
      const series = this.buildSeries(p, seconds, sub.wpm);
      return {
        playerId: p.id,
        name: p.name,
        wpm: sub.wpm,
        raw: sub.raw,
        acc: sub.acc,
        errors: sub.errors,
        consistency: consistency(series),
        series,
        elapsedMs: durationMs,
        place: 1 as const,
      };
    });

    let winnerId: string | null = null;
    if (entries.length === 2) {
      const [x, y] = entries;
      const cmp = x.wpm - y.wpm || x.acc - y.acc;
      if (cmp !== 0) {
        const winner = cmp > 0 ? x : y;
        winnerId = winner.playerId;
        for (const e of entries) e.place = e === winner ? 1 : 2;
      }
    }
    this.endRace(room, { matchId: room.matchId ?? randomUUID(), winnerId, reason: "finished", players: entries });
  }

  private cancelCountdown(room: Room): void {
    if (room.countdownTimer) clearTimeout(room.countdownTimer);
    room.countdownTimer = null;
    room.seed = null;
    room.matchId = null;
    room.startsAt = null;
    room.status = "waiting";
    for (const p of room.players) {
      p.ready = false;
      this.clearRaceData(p);
    }
  }

  private resetToWaiting(room: Room): void {
    room.status = "waiting";
    room.result = null;
    room.seed = null;
    room.matchId = null;
    room.startsAt = null;
    for (const p of room.players) {
      p.ready = false;
      this.clearRaceData(p);
    }
  }

  private finishByForfeit(room: Room, loserId: string): void {
    const winner = room.players.find((p) => p.id !== loserId && p.connected);
    const end = room.pausedAt ?? Date.now(); // time spent frozen does not count
    const seconds = Math.max(1, Math.ceil((end - (room.startsAt ?? end)) / 1000));
    const result: MatchResult = {
      matchId: room.matchId ?? randomUUID(),
      winnerId: winner?.id ?? null,
      reason: "forfeit",
      players: room.players.map((p) => this.entryFromProgress(p, p.id === winner?.id ? 1 : 2, seconds)),
    };
    this.endRace(room, result);
  }

  private clearRaceData(p: Player): void {
    p.progress = null;
    p.secWpm = {};
  }

  /** One value per elapsed second, carrying the last known WPM forward. */
  private buildSeries(p: Player, seconds: number, finalWpm?: number): number[] {
    const out: number[] = [];
    let last = 0;
    for (let k = 0; k < seconds; k++) {
      const v = p.secWpm[k];
      if (v !== undefined) last = v;
      out.push(round2(last));
    }
    if (finalWpm !== undefined && out.length > 0) out[out.length - 1] = finalWpm;
    return out;
  }

  /** Stats for a player who did not complete the text: their last streamed numbers. */
  private entryFromProgress(p: Player, place: 1 | 2, seconds: number): MatchResultPlayer {
    const pr = p.progress;
    const series = this.buildSeries(p, seconds);
    return {
      playerId: p.id,
      name: p.name,
      wpm: pr?.wpm ?? 0,
      raw: pr?.raw ?? 0,
      acc: pr?.acc ?? 0,
      errors: pr?.errors ?? 0,
      consistency: consistency(series),
      series,
      elapsedMs: null,
      place,
    };
  }

  private endRace(room: Room, result: MatchResult): void {
    const record = this.toRecord(room, result); // must read seed/startsAt before they are cleared
    room.status = "finished";
    room.result = result;
    room.seed = null;
    room.matchId = null;
    room.pausedAt = null;
    room.endsAt = null;
    room.closing = false;
    room.submissions.clear();
    if (room.endTimer) clearTimeout(room.endTimer);
    if (room.settleTimer) clearTimeout(room.settleTimer);
    room.endTimer = null;
    room.settleTimer = null;
    for (const p of room.players) p.ready = false;
    this.io.to(room.code).emit(EVENTS.raceResult, result);
    this.emitState(room);
    // Fire and forget: the players already have their result; persistence must never delay it.
    if (record) this.recorder?.enqueue(record);
  }

  private toRecord(room: Room, result: MatchResult): MatchRecord | null {
    if (!this.recorder || room.seed === null || room.startsAt === null) return null;
    const [p1, p2] = room.players;
    const r1 = result.players.find((x) => x.playerId === p1?.id);
    const r2 = result.players.find((x) => x.playerId === p2?.id);
    if (!p1 || !p2 || !r1 || !r2) return null;
    return {
      matchId: result.matchId,
      roomCode: room.code,
      wordCount: room.wordCount,
      seed: room.seed,
      bankVersion: room.bankVersion,
      reason: result.reason,
      durationMs:
        result.reason === "finished"
          ? room.durationSec * 1000
          : Math.max(0, (room.pausedAt ?? Date.now()) - room.startsAt), // forfeit: time actually raced
      winnerId: result.winnerId,
      players: [
        { id: p1.id, name: p1.name, result: r1 },
        { id: p2.id, name: p2.name, result: r2 },
      ],
    };
  }

  private removeFromRoom(room: Room, playerId: string): void {
    const player = room.players.find((p) => p.id === playerId);
    if (!player) return;

    if (player.socketId) this.io.sockets.sockets.get(player.socketId)?.leave(room.code);
    if (room.status === "countdown") this.cancelCountdown(room);
    else if (room.status === "in_progress") this.finishByForfeit(room, playerId);

    this.store.removePlayer(room, playerId);
    if (this.store.get(room.code) === room) {
      for (const p of room.players) p.ready = false;
      this.emitState(room);
    }
  }

  /** Grace period elapsed without the player coming back. */
  private expire(code: string, playerId: string): void {
    this.safely(() => {
      const room = this.store.get(code);
      const player = room?.players.find((p) => p.id === playerId);
      if (!room || !player || player.connected) return;
      player.graceTimer = null;
      player.graceUntil = null;
      if (room.status === "in_progress") {
        // Out of time mid-race: the opponent wins by forfeit. The absent player keeps their seat
        // (for the lobby grace period) so that, if they come back, they can see the result.
        this.finishByForfeit(room, playerId);
        const lobbyMs = this.opts.graceLobbyMs;
        player.graceUntil = Date.now() + lobbyMs;
        player.graceTimer = setTimeout(() => this.expire(room.code, player.id), lobbyMs);
        return;
      }
      this.removeFromRoom(room, playerId);
    });
  }

  /* ---- Helpers ---------------------------------------------------------- */

  private newPlayer(identity: Identity): Player {
    return {
      id: identity.playerId,
      name: identity.name,
      socketId: null,
      ready: false,
      connected: false,
      progress: null,
      secWpm: {},
      graceTimer: null,
      graceUntil: null,
    };
  }

  /** Bind a socket to a seat, evicting any older socket of the same player. */
  private attach(room: Room, player: Player, socket: Socket): void {
    const previous = player.socketId;
    player.socketId = socket.id; // set first so the old socket's disconnect is ignored
    player.connected = true;
    if (player.graceTimer) clearTimeout(player.graceTimer);
    player.graceTimer = null;
    player.graceUntil = null;
    socket.join(room.code);

    if (previous && previous !== socket.id) {
      const old = this.io.sockets.sockets.get(previous);
      old?.emit(EVENTS.sessionReplaced);
      old?.disconnect(true);
    }
  }

  private countdownPayload(room: Room): CountdownPayload {
    if (room.seed === null || room.startsAt === null) throw new Error("no active seed");
    const words = generateWords(room.seed, room.wordCount, room.bankVersion);
    return {
      seed: room.seed,
      durationSec: room.durationSec,
      bankVersion: room.bankVersion,
      wordCount: room.wordCount,
      checksum: wordsChecksum(words),
      serverNowMs: Date.now(),
      startsAt: room.startsAt,
    };
  }

  /** Everyone is connected again: shift the race clock by the paused time so nobody loses time. */
  private maybeResume(room: Room): void {
    if (room.status !== "in_progress" || room.pausedAt === null || room.startsAt === null) return;
    if (!room.players.every((p) => p.connected)) return;
    const pausedMs = Date.now() - room.pausedAt;
    room.startsAt += pausedMs;
    if (room.endsAt !== null) room.endsAt += pausedMs;
    room.pausedAt = null;
    this.armEndTimer(room);
    this.io.to(room.code).emit(EVENTS.raceResumed, { startsAt: room.startsAt, pausedMs } satisfies RaceResumedPayload);
  }

  private startPayload(room: Room): RaceStartPayload {
    if (room.startsAt === null) throw new Error("race has no start time");
    return { startsAt: room.startsAt };
  }

  private emitState(room: Room): void {
    this.io.to(room.code).emit(EVENTS.roomState, snapshot(room));
  }

  private emitPresence(room: Room, payload: PresencePayload): void {
    this.io.to(room.code).emit(EVENTS.playerPresence, payload);
  }

  private requireRoom(playerId: string): Room {
    const room = this.store.roomOf(playerId);
    if (!room) throw new GameError("NOT_IN_ROOM", "You are not in a room");
    return room;
  }

  private requirePlayer(room: Room, playerId: string): Player {
    const player = room.players.find((p) => p.id === playerId);
    if (!player) throw new GameError("NOT_IN_ROOM", "You are not in this room");
    return player;
  }

  /** Timer callbacks must never throw into the event loop. */
  private safely(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      console.error("[room-machine] error in timer callback:", err);
    }
  }
}

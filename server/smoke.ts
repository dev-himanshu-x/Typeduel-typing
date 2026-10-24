/* End-to-end smoke test: boots the real server in-process (short timers, free port)
   and drives it with real socket.io-client connections. Run: bun run test:server */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { io as connectClient, type Socket } from "socket.io-client";
import {
  EVENTS,
  type Ack,
  type CountdownPayload,
  type MatchResult,
  type OpponentProgress,
  type PresencePayload,
  type RaceFinishPayload,
  type RaceResumedPayload,
  type RoomSnapshot,
} from "../shared/protocol";
import { scoreTimed } from "../shared/scoring";
import { generateWords, wordsChecksum, wordsForDuration } from "../shared/words";
import { createGameServer } from "./create-server";
import type { MatchRecord, MatchStore } from "./match-recorder";

const COUNTDOWN_MS = 400;
const GRACE_LOBBY_MS = 600;
const GRACE_RACE_MS = 300;
const SUBMIT_WAIT_MS = 400;
const ORIGIN = "http://localhost:3000";

/** In-memory stand-in for the database, with controllable latency and failures. */
class FakeStore implements MatchStore {
  saved: MatchRecord[] = [];
  attempts = 0;
  delayMs = 0;
  failNext = 0; // fail this many upcoming attempts
  async save(r: MatchRecord) {
    this.attempts++;
    if (this.delayMs) await new Promise((res) => setTimeout(res, this.delayMs));
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error("simulated database outage");
    }
    if (!this.saved.some((x) => x.matchId === r.matchId)) this.saved.push(r); // idempotent per match
  }
}
const fakeStore = new FakeStore();

const server = createGameServer({
  matchStore: fakeStore,
  recorder: { retryDelaysMs: [40, 80], attemptTimeoutMs: 2_000 },
  port: 0,
  clientOrigins: [ORIGIN],
  countdownMs: COUNTDOWN_MS,
  graceLobbyMs: GRACE_LOBBY_MS,
  graceRaceMs: GRACE_RACE_MS,
  submitWaitMs: SUBMIT_WAIT_MS,
  maxWpm: 1e9, // the test "types" instantly
  allowedDurations: [1, 2, 3, 15, 30, 60, 120],
  defaultDurationSec: 30,
});

let url = "";
const open: Socket[] = [];

function client(playerId = randomUUID(), name = "player", auth: object | null = { playerId, name }) {
  const socket = connectClient(url, {
    auth: auth ?? {},
    transports: ["websocket"],
    reconnection: false,
    forceNew: true,
  });
  open.push(socket);
  return { socket, playerId };
}
type Player = ReturnType<typeof client>;

const connected = (s: Socket) =>
  new Promise<void>((resolve, reject) => {
    s.once("connect", resolve);
    s.once("connect_error", reject);
  });

function emit<T = unknown>(s: Socket, event: string, payload?: unknown): Promise<Ack<T>> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`ack timeout: ${event}`)), 2000);
    s.emit(event, payload ?? {}, (res: Ack<T>) => {
      clearTimeout(t);
      resolve(res);
    });
  });
}

function once<T>(s: Socket, event: string, pred: (p: T) => boolean = () => true, ms = 4000) {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    const handler = (p: T) => {
      if (!pred(p)) return;
      clearTimeout(t);
      s.off(event, handler);
      resolve(p);
    };
    s.on(event, handler);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function makeRoom() {
  const a = client(undefined, "alice");
  const b = client(undefined, "bob");
  await Promise.all([connected(a.socket), connected(b.socket)]);
  const created = await emit<{ room: RoomSnapshot }>(a.socket, EVENTS.roomCreate);
  assert(created.ok);
  const code = created.data.room.code;
  const joined = await emit<{ room: RoomSnapshot }>(b.socket, EVENTS.roomJoin, { code });
  assert(joined.ok);
  return { a, b, code };
}

/** Room with both players ready, countdown done and the race running. */
async function startedRace(durationSec = 30) {
  const room = await makeRoom();
  assert((await emit(room.a.socket, EVENTS.roomConfig, { durationSec })).ok);
  const countdown = once<CountdownPayload>(room.a.socket, EVENTS.raceCountdown);
  await emit(room.a.socket, EVENTS.roomReady, { ready: true });
  await emit(room.b.socket, EVENTS.roomReady, { ready: true });
  const cd = await countdown;
  await once(room.a.socket, EVENTS.raceStart);
  const words = generateWords(cd.seed, cd.wordCount, cd.bankVersion);
  return { ...room, cd, words, startedAt: Date.now() };
}

/** What a client sends when its clock hits zero: `k` complete words plus `partial` letters of the next. */
function typedFor(words: string[], k: number, partial = 0, wrongKeys = 0): RaceFinishPayload {
  const typed = words.map((w, i) => (i < k ? w : i === k ? w.slice(0, partial) : ""));
  const total = words.slice(0, k).reduce((n, w) => n + w.length + 1, 0) + partial;
  return { typed, activeIndex: k, correctKeys: total - wrongKeys, totalKeys: total };
}

/** Run a short timed race to completion: both submit after time is up. */
async function playTimed(opts: { durationSec?: number; aWords: number; bWords?: number; aWrong?: number }) {
  const race = await startedRace(opts.durationSec ?? 1);
  const resultP = once<MatchResult>(race.b.socket, EVENTS.raceResult);
  await once(race.a.socket, EVENTS.raceTimeUp);
  const aRes = await emit(race.a.socket, EVENTS.raceFinish, typedFor(race.words, opts.aWords, 0, opts.aWrong ?? 0));
  assert(aRes.ok, JSON.stringify(aRes));
  if (opts.bWords !== undefined) {
    const bRes = await emit(race.b.socket, EVENTS.raceFinish, typedFor(race.words, opts.bWords));
    assert(bRes.ok, JSON.stringify(bRes));
  }
  return { ...race, result: await resultP };
}

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}\n`, err);
    await cleanup();
    process.exit(1);
  }
}

async function cleanup() {
  for (const s of open) s.disconnect();
  await server.close();
}

async function main() {
  const port = await server.listen();
  url = `http://127.0.0.1:${port}`;
  console.log(`server up on :${port}`);

  const health = await fetch(`${url}/health`).then((r) => r.json());
  assert.equal(health.ok, true);

  await test("rejects connections without valid auth", async () => {
    for (const auth of [null, { playerId: "not-a-uuid", name: "x" }, { playerId: randomUUID(), name: "" }]) {
      const { socket } = client(undefined, "x", auth);
      const err = await new Promise<Error & { data?: { code?: string } }>((resolve) =>
        socket.once("connect_error", resolve),
      );
      assert.equal(err.data?.code, "UNAUTHORIZED");
    }
  });

  await test("rejects browser connections from a foreign origin", async () => {
    const socket = connectClient(url, {
      auth: { playerId: randomUUID(), name: "evil" },
      transports: ["polling"],
      extraHeaders: { Origin: "http://evil.example" },
      reconnection: false,
      forceNew: true,
    });
    open.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => reject(new Error("connected from foreign origin")));
      socket.once("connect_error", () => resolve());
    });
  });

  await test("room codes are 6 chars; exactly 2 players; errors for bad joins", async () => {
    const { a, code } = await makeRoom();
    assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);

    const c = client(undefined, "carol");
    await connected(c.socket);
    const full = await emit(c.socket, EVENTS.roomJoin, { code });
    assert(!full.ok && full.error.code === "ROOM_FULL");
    const missing = await emit(c.socket, EVENTS.roomJoin, { code: "ZZZZZZ" });
    assert(!missing.ok && missing.error.code === "ROOM_NOT_FOUND");
    const malformed = await emit(c.socket, EVENTS.roomJoin, { code: "abc" });
    assert(!malformed.ok && malformed.error.code === "INVALID_CODE");
    const junk = await emit(c.socket, EVENTS.roomReady, { ready: "yes" });
    assert(!junk.ok && junk.error.code === "INVALID_PAYLOAD");
    const notIn = await emit(c.socket, EVENTS.roomReady, { ready: true });
    assert(!notIn.ok && notIn.error.code === "NOT_IN_ROOM");
    const twice = await emit(a.socket, EVENTS.roomCreate);
    assert(!twice.ok && twice.error.code === "ALREADY_IN_ROOM");
  });

  await test("lowercase code is accepted", async () => {
    const a = client(undefined, "alice");
    const b = client(undefined, "bob");
    await Promise.all([connected(a.socket), connected(b.socket)]);
    const created = await emit<{ room: RoomSnapshot }>(a.socket, EVENTS.roomCreate);
    assert(created.ok);
    const joined = await emit(b.socket, EVENTS.roomJoin, { code: created.data.room.code.toLowerCase() });
    assert(joined.ok);
  });

  await test("only the host can set the race length, only between races, only to allowed values", async () => {
    const { a, b } = await makeRoom();
    const snap = once<RoomSnapshot>(b.socket, EVENTS.roomState, (st) => st.durationSec === 60);
    assert((await emit(a.socket, EVENTS.roomConfig, { durationSec: 60 })).ok);
    const st = await snap;
    assert.equal(st.wordCount, wordsForDuration(60));

    const notHost = await emit(b.socket, EVENTS.roomConfig, { durationSec: 15 });
    assert(!notHost.ok && notHost.error.code === "BAD_STATE");
    const bad = await emit(a.socket, EVENTS.roomConfig, { durationSec: 45 });
    assert(!bad.ok && bad.error.code === "INVALID_PAYLOAD");

    // Changing the rules clears ready-ups, so nobody is dragged into a race they didn't agree to.
    await emit(b.socket, EVENTS.roomReady, { ready: true });
    const cleared = once<RoomSnapshot>(a.socket, EVENTS.roomState, (x) => x.players.every((p) => !p.ready));
    await emit(a.socket, EVENTS.roomConfig, { durationSec: 15 });
    await cleared;

    await emit(a.socket, EVENTS.roomReady, { ready: true });
    await emit(b.socket, EVENTS.roomReady, { ready: true });
    await once(a.socket, EVENTS.raceStart);
    const during = await emit(a.socket, EVENTS.roomConfig, { durationSec: 30 });
    assert(!during.ok && during.error.code === "BAD_STATE");
  });

  await test("one ready does not start; both ready -> synchronized countdown + identical seed", async () => {
    const { a, b } = await makeRoom();
    const noEarly = once<CountdownPayload>(a.socket, EVENTS.raceCountdown, () => true, 250).then(
      () => "started",
      () => "quiet",
    );
    assert((await emit(a.socket, EVENTS.roomReady, { ready: true })).ok);
    assert.equal(await noEarly, "quiet");

    const ca = once<CountdownPayload>(a.socket, EVENTS.raceCountdown);
    const cb = once<CountdownPayload>(b.socket, EVENTS.raceCountdown);
    const startA = once<{ startsAt: number }>(a.socket, EVENTS.raceStart);
    const startB = once<{ startsAt: number }>(b.socket, EVENTS.raceStart);
    const t0 = Date.now();
    assert((await emit(b.socket, EVENTS.roomReady, { ready: true })).ok);
    const [pa, pb] = await Promise.all([ca, cb]);

    assert.equal(pa.seed, pb.seed);
    assert.equal(pa.startsAt, pb.startsAt);
    assert.equal(pa.checksum, pb.checksum);
    assert.equal(pa.durationSec, 30);
    assert(Number.isInteger(pa.seed) && pa.seed >= 0 && pa.seed < 2 ** 32);
    assert(Math.abs(pa.startsAt - pa.serverNowMs - COUNTDOWN_MS) < 50);
    const words = generateWords(pa.seed, pa.wordCount, pa.bankVersion);
    assert.equal(words.length, wordsForDuration(30));
    assert.equal(wordsChecksum(words), pa.checksum);
    assert.deepEqual(words, generateWords(pb.seed, pb.wordCount, pb.bankVersion));

    const [sa, sb] = await Promise.all([startA, startB]);
    assert.equal(sa.startsAt, pa.startsAt);
    assert.equal(sb.startsAt, pa.startsAt);
    const elapsed = Date.now() - t0;
    assert(elapsed >= COUNTDOWN_MS - 50 && elapsed < COUNTDOWN_MS + 400, `race:start after ${elapsed}ms`);
  });

  await test("room:state never leaks the seed", async () => {
    const { a, b } = await makeRoom();
    const states: unknown[] = [];
    a.socket.on(EVENTS.roomState, (s) => states.push(s));
    await emit(a.socket, EVENTS.roomReady, { ready: true });
    await emit(b.socket, EVENTS.roomReady, { ready: true });
    await once(a.socket, EVENTS.raceStart);
    await sleep(60); // the in_progress room:state is emitted just after race:start
    assert(states.length >= 3);
    for (const s of states) assert(!("seed" in (s as object)));
  });

  await test("un-readying during the countdown cancels it", async () => {
    const { a, b } = await makeRoom();
    await emit(a.socket, EVENTS.roomReady, { ready: true });
    const counting = once(a.socket, EVENTS.raceCountdown);
    await emit(b.socket, EVENTS.roomReady, { ready: true });
    await counting;
    const waiting = once<RoomSnapshot>(a.socket, EVENTS.roomState, (s) => s.status === "waiting");
    await emit(b.socket, EVENTS.roomReady, { ready: false });
    const state = await waiting;
    assert.equal(state.startsAt, null);
    assert(state.players.every((p) => !p.ready));
    const started = await once(a.socket, EVENTS.raceStart, () => true, COUNTDOWN_MS + 300).then(
      () => true,
      () => false,
    );
    assert.equal(started, false);
  });

  await test("disconnect in the lobby: presence, reclaim within grace", async () => {
    const { a, b, code } = await makeRoom();
    const gone = once<PresencePayload>(a.socket, EVENTS.playerPresence, (p) => !p.connected);
    b.socket.disconnect();
    const presence = await gone;
    assert.equal(presence.playerId, b.playerId);
    assert.equal(presence.graceMs, GRACE_LOBBY_MS);

    const b2 = client(b.playerId, "bob");
    const restored = once<RoomSnapshot>(b2.socket, EVENTS.roomState);
    await connected(b2.socket);
    const state = await restored;
    assert.equal(state.code, code);
    assert(state.players.find((p) => p.id === b.playerId)?.connected);
    await sleep(GRACE_LOBBY_MS + 200);
    assert.equal(server.store.get(code)?.players.length, 2, "seat survived past the grace window");
  });

  await test("disconnect in the lobby: seat released after grace", async () => {
    const { a, b, code } = await makeRoom();
    b.socket.disconnect();
    await once<RoomSnapshot>(a.socket, EVENTS.roomState, (s) => s.players.length === 1);
    assert.equal(server.store.get(code)?.players.length, 1);
    const c = client(undefined, "carol");
    await connected(c.socket);
    assert((await emit(c.socket, EVENTS.roomJoin, { code })).ok);
  });

  await test("disconnect during the countdown cancels it", async () => {
    const { a, b } = await makeRoom();
    await emit(a.socket, EVENTS.roomReady, { ready: true });
    const counting = once(a.socket, EVENTS.raceCountdown);
    await emit(b.socket, EVENTS.roomReady, { ready: true });
    await counting;
    const cancelled = once<RoomSnapshot>(a.socket, EVENTS.roomState, (s) => s.status === "waiting");
    b.socket.disconnect();
    assert.equal((await cancelled).startsAt, null);
  });

  await test("abrupt transport death is handled like a disconnect", async () => {
    const { a, b } = await makeRoom();
    const gone = once<PresencePayload>(a.socket, EVENTS.playerPresence, (p) => !p.connected);
    b.socket.io.engine.close(); // no clean socket.io disconnect packet
    assert.equal((await gone).playerId, b.playerId);
  });

  await test("reconnecting mid-race resends the seed; old socket is replaced", async () => {
    const { a, b, cd } = await startedRace();
    const b2 = client(b.playerId, "bob");
    const replaced = once(b.socket, EVENTS.sessionReplaced);
    const resent = once<CountdownPayload>(b2.socket, EVENTS.raceCountdown);
    await connected(b2.socket);
    const again = await resent;
    assert.equal(again.seed, cd.seed);
    assert.equal(again.durationSec, 30);
    await replaced;
    // The replaced socket's disconnect must not mark the player as gone.
    await sleep(GRACE_RACE_MS + 200);
    assert.equal(server.store.roomOf(b.playerId)?.players.find((p) => p.id === b.playerId)?.connected, true);
    assert(a.socket.connected);
  });

  await test("leave frees the seat; garbage input never crashes the server", async () => {
    const { a, b, code } = await makeRoom();
    assert((await emit(b.socket, EVENTS.roomLeave)).ok);
    assert.equal(server.store.get(code)?.players.length, 1);

    a.socket.emit(EVENTS.roomReady);
    a.socket.emit(EVENTS.roomJoin, 12345);
    a.socket.emit(EVENTS.roomReady, null, "not-a-function");
    a.socket.emit("nonsense:event", { x: 1 });
    await sleep(100);
    assert.equal((await fetch(`${url}/health`).then((r) => r.json())).ok, true);
    assert((await emit(a.socket, EVENTS.timeSync, { clientSentMs: 1 })).ok);
  });

  await test("empty rooms are deleted", async () => {
    const before = server.store.size;
    const { a, b, code } = await makeRoom();
    assert.equal(server.store.size, before + 1);
    await emit(a.socket, EVENTS.roomLeave);
    await emit(b.socket, EVENTS.roomLeave);
    assert.equal(server.store.get(code), undefined);
    assert.equal(server.store.size, before);
  });

  /* ---- progress ---- */

  await test("progress is relayed to the opponent only; stale/invalid reports dropped", async () => {
    const { a, b } = await startedRace();
    const seen: OpponentProgress[] = [];
    const echoed: OpponentProgress[] = [];
    b.socket.on(EVENTS.raceProgress, (p) => seen.push(p));
    a.socket.on(EVENTS.raceProgress, (p) => echoed.push(p));
    const rep = (seq: number, wordIndex: number, wpm: unknown) => ({ seq, wordIndex, charIndex: 3, wpm, raw: 55, acc: 90, errors: 2 });

    a.socket.emit(EVENTS.raceProgress, rep(1, 2, 50));
    a.socket.emit(EVENTS.raceProgress, rep(1, 9, 50)); // stale seq
    a.socket.emit(EVENTS.raceProgress, rep(2, 9999, 50)); // bad index
    a.socket.emit(EVENTS.raceProgress, rep(3, 0, "fast")); // bad type
    a.socket.emit(EVENTS.raceProgress, rep(4, 5, 60));
    await sleep(200);
    assert.deepEqual(seen.map((p) => [p.seq, p.wordIndex, p.playerId]), [[1, 2, a.playerId], [4, 5, a.playerId]]);
    assert.equal(echoed.length, 0, "sender must not receive its own progress");
  });

  /* ---- timed race ---- */

  await test("time up: both submit, the server recomputes stats, higher WPM wins", async () => {
    const m = await playTimed({ durationSec: 2, aWords: 12, bWords: 7 });
    const r = m.result;
    assert.equal(r.reason, "finished");
    assert.equal(r.winnerId, m.a.playerId);
    const a = r.players.find((p) => p.playerId === m.a.playerId)!;
    const b = r.players.find((p) => p.playerId === m.b.playerId)!;
    const expectA = scoreTimed(m.words, typedFor(m.words, 12).typed, 12, 0, 0, 2000);
    assert.equal(a.wpm, expectA.wpm);
    assert(a.wpm > b.wpm && b.wpm > 0);
    assert.equal(a.place, 1);
    assert.equal(b.place, 2);
    assert.equal(a.elapsedMs, 2000);
    assert.equal(a.series.length, 2);
    assert.equal(a.series.at(-1), a.wpm);
    assert.equal(a.acc, 100);
  });

  await test("a partially typed last word is scored on its correct prefix, wrong keys lower accuracy", async () => {
    const race = await startedRace(1);
    const resultP = once<MatchResult>(race.a.socket, EVENTS.raceResult);
    await once(race.a.socket, EVENTS.raceTimeUp);
    const pa = typedFor(race.words, 5, 2, 3);
    const fa = await emit(race.a.socket, EVENTS.raceFinish, pa);
    assert(fa.ok);
    await emit(race.b.socket, EVENTS.raceFinish, typedFor(race.words, 0));
    const r = await resultP;
    const a = r.players.find((p) => p.playerId === race.a.playerId)!;
    const want = scoreTimed(race.words, pa.typed, 5, pa.correctKeys, pa.totalKeys, 1000);
    assert.equal(a.wpm, want.wpm);
    assert.equal(a.errors, 3);
    assert(a.acc < 100);
    assert(want.tally.correctWord >= race.words.slice(0, 5).join(" ").length, "committed words all counted");
  });

  await test("equal WPM and accuracy is a draw (no winner, both place 1)", async () => {
    const m = await playTimed({ aWords: 6, bWords: 6 });
    assert.equal(m.result.winnerId, null);
    assert(m.result.players.every((p) => p.place === 1));
  });

  await test("a player who never submits is scored from their last streamed numbers (DNF)", async () => {
    const race = await startedRace(1);
    race.b.socket.emit(EVENTS.raceProgress, { seq: 1, wordIndex: 3, charIndex: 1, wpm: 41, raw: 47, acc: 88, errors: 5 });
    await sleep(50);
    const resultP = once<MatchResult>(race.a.socket, EVENTS.raceResult);
    await once(race.a.socket, EVENTS.raceTimeUp);
    await emit(race.a.socket, EVENTS.raceFinish, typedFor(race.words, 9));
    const r = await resultP; // after SUBMIT_WAIT_MS
    const b = r.players.find((p) => p.playerId === race.b.playerId)!;
    assert.equal(b.wpm, 41);
    assert.equal(b.raw, 47);
    assert.equal(b.errors, 5);
    assert.equal(b.elapsedMs, null);
    assert.equal(r.winnerId, race.a.playerId);
  });

  await test("bad submissions are rejected: early, duplicate, wrong shape, input after the active word", async () => {
    const early = await startedRace(30);
    const tooSoon = await emit(early.a.socket, EVENTS.raceFinish, typedFor(early.words, 3));
    assert(!tooSoon.ok && tooSoon.error.code === "BAD_STATE", "30s race is nowhere near over");

    const race = await startedRace(1);
    await once(race.a.socket, EVENTS.raceTimeUp);
    const short = await emit(race.a.socket, EVENTS.raceFinish, { typed: ["x"], activeIndex: 0, correctKeys: 1, totalKeys: 1 });
    assert(!short.ok && short.error.code === "INVALID_PAYLOAD");
    const trailing = typedFor(race.words, 3);
    trailing.typed[10] = "oops";
    const after = await emit(race.a.socket, EVENTS.raceFinish, trailing);
    assert(!after.ok && after.error.code === "INVALID_PAYLOAD");
    const badKeys = await emit(race.a.socket, EVENTS.raceFinish, { ...typedFor(race.words, 3), correctKeys: 9, totalKeys: 2 });
    assert(!badKeys.ok);
    assert((await emit(race.a.socket, EVENTS.raceFinish, typedFor(race.words, 3))).ok);
    const dup = await emit(race.a.socket, EVENTS.raceFinish, typedFor(race.words, 4));
    assert(!dup.ok && dup.error.code === "BAD_STATE");
  });

  await test("rematch: both ready after a result starts a new race with a new seed in the same room", async () => {
    const m = await playTimed({ aWords: 4, bWords: 2 });
    const code = server.store.roomOf(m.a.playerId)!.code;
    await emit(m.a.socket, EVENTS.roomReady, { ready: true });
    const next = once<CountdownPayload>(m.b.socket, EVENTS.raceCountdown);
    await emit(m.b.socket, EVENTS.roomReady, { ready: true });
    const cd = await next;
    assert.notEqual(cd.seed, m.cd.seed);
    assert.equal(server.store.roomOf(m.a.playerId)!.code, code);
    assert.equal(cd.durationSec, 1, "the room keeps its configured length");
  });

  /* ---- persistence (against an in-memory store) ---- */

  const savedIds = new Set<string>();
  const failedIds = new Set<string>();
  const trackSaves = (p: Player) => {
    p.socket.on(EVENTS.matchSaved, (x: { matchId: string }) => savedIds.add(x.matchId));
    p.socket.on(EVENTS.matchSaveFailed, (x: { matchId: string }) => failedIds.add(x.matchId));
  };
  const waitFor = async (cond: () => boolean, ms = 2000) => {
    const t0 = Date.now();
    while (!cond()) {
      if (Date.now() - t0 > ms) throw new Error("condition not met in time");
      await sleep(10);
    }
  };
  async function recordedMatch() {
    const race = await startedRace(1);
    trackSaves(race.a);
    const resultP = once<MatchResult>(race.b.socket, EVENTS.raceResult);
    await once(race.a.socket, EVENTS.raceTimeUp);
    await emit(race.a.socket, EVENTS.raceFinish, typedFor(race.words, 8, 0, 1));
    await emit(race.b.socket, EVENTS.raceFinish, typedFor(race.words, 3));
    return { ...race, result: await resultP };
  }

  await test("a finished match is persisted with both players' metrics and announced", async () => {
    const m = await recordedMatch(); // (earlier tests may leave races running; look this match up by id)
    await waitFor(() => fakeStore.saved.some((r) => r.matchId === m.result.matchId));
    await waitFor(() => savedIds.has(m.result.matchId));

    const rec = fakeStore.saved.find((r) => r.matchId === m.result.matchId)!;
    assert.equal(rec.reason, "finished");
    assert.equal(rec.winnerId, m.a.playerId);
    assert.equal(rec.players[0].id, m.a.playerId, "player1 = first to join (the creator)");
    assert.equal(rec.players[1].id, m.b.playerId);
    assert.equal(rec.players[0].name, "alice");
    assert.equal(rec.wordCount, wordsForDuration(1));
    assert.equal(rec.bankVersion, 2);
    assert.equal(rec.durationMs, 1000);
    assert.deepEqual(generateWords(rec.seed, rec.wordCount, rec.bankVersion), m.words, "seed regenerates the exact text");
    assert.equal(rec.players[0].result.errors, 1);
    assert.equal(rec.players[1].result.errors, 0);
  });

  await test("a forfeit is persisted too (reason = forfeit)", async () => {
    const { a, b } = await startedRace();
    const resultP = once<MatchResult>(a.socket, EVENTS.raceResult);
    b.socket.disconnect();
    const result = await resultP;
    await waitFor(() => fakeStore.saved.some((r) => r.matchId === result.matchId));
    const rec = fakeStore.saved.find((r) => r.matchId === result.matchId)!;
    assert.equal(rec.reason, "forfeit");
    assert.equal(rec.winnerId, a.playerId);
  });

  await test("slow database writes never delay the result or block the event loop", async () => {
    fakeStore.delayMs = 500;
    let last = Date.now();
    let worstGap = 0;
    const beat = setInterval(() => {
      const now = Date.now();
      worstGap = Math.max(worstGap, now - last);
      last = now;
    }, 10);
    try {
      const race = await startedRace(1);
      const resultB = once<MatchResult>(race.b.socket, EVENTS.raceResult);
      const savedB = once<{ matchId: string }>(race.b.socket, EVENTS.matchSaved);
      await once(race.a.socket, EVENTS.raceTimeUp);
      const t0 = Date.now();
      await emit(race.a.socket, EVENTS.raceFinish, typedFor(race.words, 6));
      await emit(race.b.socket, EVENTS.raceFinish, typedFor(race.words, 4));
      const result = await resultB;
      const resultAt = Date.now() - t0;
      assert.equal((await savedB).matchId, result.matchId);
      const savedAt = Date.now() - t0;
      assert(resultAt < 250, `result took ${resultAt}ms: it must not wait for the 500ms write`);
      assert(savedAt >= 450, `saved event arrived after ${savedAt}ms; expected after the write`);
      assert(worstGap < 120, `event loop stalled for ${worstGap}ms during the slow write`);
    } finally {
      clearInterval(beat);
      fakeStore.delayMs = 0;
    }
  });

  await test("transient database errors are retried; permanent ones are reported, server survives", async () => {
    fakeStore.failNext = 2; // fails twice, third attempt succeeds
    const m1 = await recordedMatch();
    await waitFor(() => fakeStore.saved.some((r) => r.matchId === m1.result.matchId));

    const attemptsBefore = fakeStore.attempts;
    fakeStore.failNext = 99; // never succeeds
    const m2 = await recordedMatch();
    await waitFor(() => failedIds.has(m2.result.matchId), 3000);
    assert.equal(fakeStore.attempts - attemptsBefore, 3, "initial attempt + 2 retries");
    assert(!fakeStore.saved.some((r) => r.matchId === m2.result.matchId));

    fakeStore.failNext = 0;
    const m3 = await recordedMatch();
    await waitFor(() => fakeStore.saved.some((r) => r.matchId === m3.result.matchId));
    assert.equal((await fetch(`${url}/health`).then((r) => r.json())).ok, true);
  });

  /* ---- pause / resume / forfeit ---- */

  await test("a mid-race disconnect pauses the race; returning resumes it and shifts the end time", async () => {
    const race = await startedRace(2);
    const { a, b } = race;
    const startsAt0 = server.store.roomOf(a.playerId)!.startsAt!;
    const endsAt0 = server.store.roomOf(a.playerId)!.endsAt!;
    assert.equal(endsAt0 - startsAt0, 2000);

    await sleep(300);
    const pausedState = once<RoomSnapshot>(a.socket, EVENTS.roomState, (st) => st.paused !== null);
    b.socket.disconnect();
    const st = await pausedState;
    assert.deepEqual(st.paused!.playerIds, [b.playerId]);
    assert(st.paused!.until > Date.now() && st.paused!.graceMs === GRACE_RACE_MS);

    // Frozen: finishing is refused, progress is ignored, and time-up does not fire.
    const frozen = await emit(a.socket, EVENTS.raceFinish, typedFor(race.words, 3));
    assert(!frozen.ok && frozen.error.code === "BAD_STATE");

    await sleep(120);
    const resumed = once<RaceResumedPayload>(a.socket, EVENTS.raceResumed);
    const b2 = client(b.playerId, "bob");
    await connected(b2.socket);
    const r = await resumed;
    assert(r.pausedMs >= 100 && r.pausedMs < GRACE_RACE_MS, `pausedMs ${r.pausedMs}`);
    assert.equal(r.startsAt, startsAt0 + r.pausedMs);
    assert.equal(server.store.roomOf(a.playerId)!.endsAt, endsAt0 + r.pausedMs, "end time shifted by the paused time");

    // The race still lasts its full 2s of *racing* time.
    const timeup = await once(a.socket, EVENTS.raceTimeUp);
    void timeup;
    const raced = Date.now() - race.startedAt - r.pausedMs;
    assert(raced >= 2000 - 120 && raced < 2000 + 250, `raced for ${raced}ms`);
  });

  await test("if the reconnection window expires while paused, the remaining player wins by forfeit", async () => {
    const { a, b } = await startedRace();
    const pausedState = once<RoomSnapshot>(a.socket, EVENTS.roomState, (st) => st.paused !== null);
    const resultP = once<MatchResult>(a.socket, EVENTS.raceResult);
    b.socket.disconnect();
    await pausedState;
    const t0 = Date.now();
    const res = await resultP;
    const waited = Date.now() - t0;
    assert(waited >= GRACE_RACE_MS - 60 && waited < GRACE_RACE_MS + 300, `forfeit after ${waited}ms`);
    assert.equal(res.reason, "forfeit");
    assert.equal(res.winnerId, a.playerId);
  });

  await test("after a disconnect forfeit the absent player keeps their seat and sees the result on return", async () => {
    const { a, b } = await startedRace();
    const code = server.store.roomOf(a.playerId)!.code;
    const resultP = once<MatchResult>(a.socket, EVENTS.raceResult);
    b.socket.disconnect();
    const res = await resultP;
    assert.equal(res.winnerId, a.playerId);
    assert.equal(server.store.get(code)!.players.length, 2);

    const b2 = client(b.playerId, "bob");
    const back = once<RoomSnapshot>(b2.socket, EVENTS.roomState, (st) => st.status === "finished");
    await connected(b2.socket);
    const st = await back;
    assert.equal(st.result?.reason, "forfeit");
    assert.equal(st.result?.winnerId, a.playerId);
    assert(st.players.find((p) => p.id === b.playerId)?.connected);
  });

  await cleanup();
  console.log(`\nall ${passed} checks passed`);
}

main().catch(async (err) => {
  console.error(err);
  await cleanup();
  process.exit(1);
});

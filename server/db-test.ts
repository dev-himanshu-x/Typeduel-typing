/* Integration test against the real Postgres in DATABASE_URL (Neon). Everything it writes uses
   fresh random ids and is deleted afterwards. Run: bun run test:db */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { inArray } from "drizzle-orm";
import { createDb } from "../db";
import { findUser, getHeadToHead, getHistory, getTotals } from "../db/queries";
import { matchResults, matches, users } from "../db/schema";
import { MatchRecorder, type MatchRecord } from "./match-recorder";
import { PgMatchStore } from "./pg-match-store";

try {
  process.loadEnvFile(".env.local");
} catch {
  /* env provided by the shell */
}
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const { db, pool } = createDb(url);
const store = new PgMatchStore(db);
const userIds = new Set<string>();
const matchIds = new Set<string>();

function record(p1: string, p2: string, winner: string | null, over: Partial<MatchRecord> = {}): MatchRecord {
  const matchId = randomUUID();
  matchIds.add(matchId);
  const res = (id: string, name: string, wpm: number, place: 1 | 2, finished: boolean) => ({
    playerId: id,
    name,
    wpm,
    raw: wpm + 3,
    acc: 96.5,
    errors: 4,
    consistency: 88.2,
    series: [wpm - 10, wpm - 5, wpm],
    elapsedMs: finished ? 14_500 : null,
    place,
  });
  return {
    matchId,
    roomCode: "ABC234",
    wordCount: 30,
    seed: 4_000_000_000, // > int4 on purpose
    bankVersion: 1,
    reason: "finished",
    durationMs: 14_500,
    winnerId: winner,
    players: [
      { id: p1, name: NAME, result: res(p1, NAME, 100, winner === p1 ? 1 : 2, winner === p1) },
      { id: p2, name: NAME, result: res(p2, NAME, 80, winner === p2 ? 1 : 2, winner === p2) },
    ],
    ...over,
  };
}

const NAME = `t${Math.random().toString(36).slice(2, 7)}`; // unique per run so real players never collide
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
  const m = [...matchIds];
  const u = [...userIds];
  if (m.length) {
    await db.delete(matchResults).where(inArray(matchResults.matchId, m));
    await db.delete(matches).where(inArray(matches.id, m));
  }
  if (u.length) await db.delete(users).where(inArray(users.id, u));
  await pool.end();
}

const newUser = () => {
  const id = randomUUID();
  userIds.add(id);
  return id;
};

const pgCode = (e: unknown) => (e as { code?: string; cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code;

async function main() {
  const [a, b, c] = [newUser(), newUser(), newUser()];

  await test("saves a match with both players' metrics; colliding usernames get suffixed", async () => {
    const r = record(a, b, a);
    await store.save(r);

    const rows = await db.select().from(users).where(inArray(users.id, [a, b]));
    assert.equal(rows.length, 2);
    const names = rows.map((x) => x.username).sort();
    assert.notEqual(names[0].toLowerCase(), names[1].toLowerCase(), "usernames stay unique");
    assert(names.some((n) => n === NAME) && names.some((n) => n.startsWith(`${NAME}-`)), names.join());

    const [m] = await db.select().from(matches).where(inArray(matches.id, [r.matchId]));
    assert.equal(m.winnerId, a);
    assert.equal(m.seed, 4_000_000_000);
    assert.equal(m.reason, "finished");
    const res = await db.select().from(matchResults).where(inArray(matchResults.matchId, [r.matchId]));
    assert.equal(res.length, 2);
    const mine = res.find((x) => x.userId === a)!;
    assert.equal(mine.finalWpm, 100);
    assert.equal(mine.accuracy, 96.5);
    assert.equal(mine.errorCount, 4);
    assert.deepEqual(mine.timelineData.wpm, [90, 95, 100]);
    assert.equal(mine.timelineData.place, 1);
  });

  await test("saving the same match again is a no-op (idempotent retries)", async () => {
    const r = record(a, b, b);
    await store.save(r);
    await store.save(r);
    const res = await db.select().from(matchResults).where(inArray(matchResults.matchId, [r.matchId]));
    assert.equal(res.length, 2);
  });

  await test("database constraints reject impossible rows", async () => {
    const bad = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (e) {
        return pgCode(e);
      }
      return undefined;
    };
    const id = randomUUID();
    matchIds.add(id);
    const base = { id, roomCode: "ABC234", wordCount: 30, seed: 1, bankVersion: 1, reason: "finished" as const };
    assert.equal(await bad(() => db.insert(matches).values({ ...base, player1Id: a, player2Id: a })), "23514", "same player twice");
    assert.equal(await bad(() => db.insert(matches).values({ ...base, player1Id: a, player2Id: b, winnerId: c })), "23514", "winner not in match");
    assert.equal(await bad(() => db.insert(matches).values({ ...base, player1Id: a, player2Id: randomUUID() })), "23503", "unknown user");
    assert.equal(await bad(() => db.insert(users).values({ id: randomUUID(), username: "bad name!" })), "23514", "username format");
    assert.equal(await bad(() => db.insert(users).values({ id: randomUUID(), username: NAME.toUpperCase() })), "23505", "case-insensitive unique");
  });

  await test("profile queries: totals, head-to-head and history", async () => {
    // a vs b so far: 1 win (a), 1 loss (a lost the second). Add a win vs c and a draw vs c.
    await store.save(record(a, c, a));
    await store.save(record(c, a, null, { reason: "forfeit" }));

    const ta = await getTotals(db, a);
    assert.equal(ta.matches, 4);
    assert.equal(ta.wins, 2);
    assert.equal(ta.losses, 1);
    assert.equal(ta.draws, 1);
    assert(ta.bestWpm >= 100 && ta.avgAccuracy > 96);

    const h2h = await getHeadToHead(db, a);
    const vsB = h2h.find((x) => x.opponentId === b)!;
    const vsC = h2h.find((x) => x.opponentId === c)!;
    assert.deepEqual([vsB.matches, vsB.wins, vsB.losses, vsB.draws], [2, 1, 1, 0]);
    assert.deepEqual([vsC.matches, vsC.wins, vsC.losses, vsC.draws], [2, 1, 0, 1]);

    const hist = await getHistory(db, a, 10);
    assert.equal(hist.length, 4);
    assert(hist.every((h) => h.playedAt instanceof Date && !Number.isNaN(+h.playedAt)), "dates are real Dates");
    assert(hist[0].playedAt >= hist[hist.length - 1].playedAt, "newest first");
    assert(h2h.every((h) => h.lastPlayed instanceof Date && !Number.isNaN(+h.lastPlayed)));
    assert(hist.every((h) => ["win", "loss", "draw"].includes(h.outcome)));
    assert(hist.some((h) => h.reason === "forfeit" && h.outcome === "draw"));

    const byName = await findUser(db, (await db.select().from(users).where(inArray(users.id, [a])))[0].username.toUpperCase());
    assert.equal(byName?.id, a, "lookup by username is case-insensitive");
    assert.equal((await findUser(db, a))?.id, a, "lookup by id");
    assert.equal(await findUser(db, "no-such-player-xyz"), null);
  });

  await test("recording 40 matches through the recorder never stalls the event loop", async () => {
    const [x, y] = [newUser(), newUser()];
    const recs = Array.from({ length: 40 }, (_, i) => record(x, y, i % 2 ? x : y));
    const saved = new Set<string>();
    const recorder = new MatchRecorder(
      store,
      { concurrency: 4, maxQueue: 500, retryDelaysMs: [200], attemptTimeoutMs: 10_000 },
      { onSaved: (r) => saved.add(r.matchId) },
    );
    const h = monitorEventLoopDelay({ resolution: 5 });
    h.enable();
    const t0 = Date.now();
    for (const r of recs) recorder.enqueue(r); // synchronous, returns immediately
    const enqueueMs = Date.now() - t0;
    await recorder.drain(30_000);
    h.disable();
    const totalMs = Date.now() - t0;
    assert.equal(saved.size, 40, `${saved.size}/40 saved`);
    const p99 = h.percentile(99) / 1e6;
    const max = h.max / 1e6;
    console.log(`        enqueue ${enqueueMs}ms, all 40 saved in ${totalMs}ms, event-loop delay p99 ${p99.toFixed(1)}ms max ${max.toFixed(1)}ms`);
    assert(enqueueMs < 50, `enqueue blocked for ${enqueueMs}ms`);
    assert(p99 < 100, `event loop p99 delay ${p99}ms`);
  });

  await cleanup();
  const { db: d2, pool: p2 } = createDb(url!);
  const left = (await d2.select({ id: users.id }).from(users).where(inArray(users.id, [...userIds]))).length;
  const leftM = (await d2.select({ id: matches.id }).from(matches).where(inArray(matches.id, [...matchIds]))).length;
  await p2.end();
  assert.equal(left + leftM, 0, "test rows were cleaned up");
  console.log(`\nall ${passed} checks passed; test data removed`);
}

main().catch(async (err) => {
  console.error(err);
  await cleanup().catch(() => {});
  process.exit(1);
});

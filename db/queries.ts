import { eq, sql } from "drizzle-orm";
import type { Db } from "./index";
import { users } from "./schema";

/* Read side for the profile page. Plain SQL where aggregation is clearer than the query builder. */

export interface ProfileUser {
  id: string;
  username: string;
  createdAt: Date;
}

export interface Totals {
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  /** Best / average WPM over matches the player actually finished (self-reported DNF numbers excluded). */
  bestWpm: number;
  avgWpm: number;
  avgAccuracy: number;
}

export interface HeadToHeadRow {
  opponentId: string;
  opponentName: string;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  lastPlayed: Date;
}

export interface HistoryRow {
  matchId: string;
  playedAt: Date;
  reason: "finished" | "forfeit";
  outcome: "win" | "loss" | "draw";
  wpm: number;
  accuracy: number;
  errors: number;
  durationMs: number | null;
  finished: boolean;
  opponentId: string;
  opponentName: string;
  opponentWpm: number | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `handle` is a user id (uuid) or a username (case-insensitive). */
export async function findUser(db: Db, handle: string): Promise<ProfileUser | null> {
  const where = UUID.test(handle) ? eq(users.id, handle) : sql`lower(${users.username}) = lower(${handle})`;
  const [row] = await db.select().from(users).where(where).limit(1);
  return row ?? null;
}

export async function getTotals(db: Db, userId: string): Promise<Totals> {
  const { rows } = await db.execute<{
    matches: number;
    wins: number;
    losses: number;
    draws: number;
    best_wpm: number;
    avg_wpm: number;
    avg_acc: number;
  }>(sql`
    select count(*)::int as matches,
           count(*) filter (where m.winner_id = ${userId}::uuid)::int as wins,
           count(*) filter (where m.winner_id is not null and m.winner_id <> ${userId}::uuid)::int as losses,
           count(*) filter (where m.winner_id is null)::int as draws,
           coalesce(max(mr.final_wpm) filter (where mr.timeline_data->>'elapsedMs' is not null), 0)::float8 as best_wpm,
           coalesce(avg(mr.final_wpm) filter (where mr.timeline_data->>'elapsedMs' is not null), 0)::float8 as avg_wpm,
           coalesce(avg(mr.accuracy), 0)::float8 as avg_acc
    from match_results mr
    join matches m on m.id = mr.match_id
    where mr.user_id = ${userId}::uuid
  `);
  const r = rows[0];
  return {
    matches: r?.matches ?? 0,
    wins: r?.wins ?? 0,
    losses: r?.losses ?? 0,
    draws: r?.draws ?? 0,
    bestWpm: r?.best_wpm ?? 0,
    avgWpm: r?.avg_wpm ?? 0,
    avgAccuracy: r?.avg_acc ?? 0,
  };
}

/** Record against each opponent, most-played first. */
export async function getHeadToHead(db: Db, userId: string, limit = 50): Promise<HeadToHeadRow[]> {
  const { rows } = await db.execute<{
    opponent_id: string;
    opponent_name: string;
    matches: number;
    wins: number;
    losses: number;
    draws: number;
    last_played: Date | string;
  }>(sql`
    select opp.id as opponent_id,
           opp.username as opponent_name,
           count(*)::int as matches,
           count(*) filter (where m.winner_id = ${userId}::uuid)::int as wins,
           count(*) filter (where m.winner_id is not null and m.winner_id <> ${userId}::uuid)::int as losses,
           count(*) filter (where m.winner_id is null)::int as draws,
           max(m.created_at) as last_played
    from matches m
    join users opp on opp.id = case when m.player1_id = ${userId}::uuid then m.player2_id else m.player1_id end
    where m.player1_id = ${userId}::uuid or m.player2_id = ${userId}::uuid
    group by opp.id, opp.username
    order by matches desc, last_played desc
    limit ${limit}
  `);
  return rows.map((r) => ({
    opponentId: r.opponent_id,
    opponentName: r.opponent_name,
    matches: r.matches,
    wins: r.wins,
    losses: r.losses,
    draws: r.draws,
    lastPlayed: new Date(r.last_played), // raw execute() yields timestamps as strings
  }));
}

export async function getHistory(db: Db, userId: string, limit = 25): Promise<HistoryRow[]> {
  const { rows } = await db.execute<{
    match_id: string;
    played_at: Date | string;
    reason: "finished" | "forfeit";
    winner_id: string | null;
    wpm: number;
    accuracy: number;
    errors: number;
    duration_ms: number | null;
    finished: boolean;
    opponent_id: string;
    opponent_name: string;
    opponent_wpm: number | null;
  }>(sql`
    select m.id as match_id,
           m.created_at as played_at,
           m.reason,
           m.winner_id,
           mr.final_wpm::float8 as wpm,
           mr.accuracy::float8 as accuracy,
           mr.error_count as errors,
           m.duration_ms,
           (mr.timeline_data->>'elapsedMs') is not null as finished,
           opp.id as opponent_id,
           opp.username as opponent_name,
           omr.final_wpm::float8 as opponent_wpm
    from match_results mr
    join matches m on m.id = mr.match_id
    join users opp on opp.id = case when m.player1_id = mr.user_id then m.player2_id else m.player1_id end
    left join match_results omr on omr.match_id = m.id and omr.user_id = opp.id
    where mr.user_id = ${userId}::uuid
    order by m.created_at desc
    limit ${limit}
  `);
  return rows.map((r) => ({
    matchId: r.match_id,
    playedAt: new Date(r.played_at),
    reason: r.reason,
    outcome: r.winner_id === null ? "draw" : r.winner_id === userId ? "win" : "loss",
    wpm: r.wpm,
    accuracy: r.accuracy,
    errors: r.errors,
    durationMs: r.duration_ms,
    finished: r.finished,
    opponentId: r.opponent_id,
    opponentName: r.opponent_name,
    opponentWpm: r.opponent_wpm,
  }));
}

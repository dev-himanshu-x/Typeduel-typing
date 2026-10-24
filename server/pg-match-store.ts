import { eq } from "drizzle-orm";
import type { Db } from "../db";
import { matchResults, matches, users } from "../db/schema";
import type { MatchRecord, MatchStore } from "./match-recorder";

const USERNAME_MAX = 16;

/** Usernames are `[A-Za-z0-9_-]{1,16}`; map whatever the player typed onto that. */
export function sanitizeUsername(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, USERNAME_MAX);
  return cleaned.length > 0 ? cleaned : "player";
}

/** First try the plain name, then `name-<id>`, then random suffixes. */
export function usernameCandidates(name: string, id: string): string[] {
  const base = sanitizeUsername(name);
  const stem = base.slice(0, USERNAME_MAX - 5);
  const out = [base, `${stem}-${id.replace(/-/g, "").slice(0, 4)}`];
  for (let i = 0; i < 6; i++) out.push(`${stem}-${Math.random().toString(16).slice(2, 6)}`);
  return out;
}

const pgCode = (err: unknown): string | undefined => {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.cause?.code ?? e?.code;
};

const finite = (n: number) => (Number.isFinite(n) ? n : 0);

/** Drizzle/Postgres implementation. All writes are async I/O, so the event loop stays free. */
export class PgMatchStore implements MatchStore {
  private known = new Set<string>(); // ids we know exist in `users`

  constructor(
    private readonly db: Db,
    private readonly closePool?: () => Promise<void>,
  ) {}

  async save(r: MatchRecord): Promise<void> {
    for (const p of r.players) await this.ensureUser(p.id, p.name);

    // Match + both results commit together or not at all; re-running after a partial
    // failure is safe because every insert is keyed on the match id.
    await this.db.transaction(async (tx) => {
      await tx
        .insert(matches)
        .values({
          id: r.matchId,
          roomCode: r.roomCode,
          player1Id: r.players[0].id,
          player2Id: r.players[1].id,
          winnerId: r.winnerId,
          wordCount: r.wordCount,
          seed: r.seed,
          bankVersion: r.bankVersion,
          reason: r.reason,
          durationMs: r.durationMs,
        })
        .onConflictDoNothing({ target: matches.id });

      await tx
        .insert(matchResults)
        .values(
          r.players.map((p) => ({
            matchId: r.matchId,
            userId: p.id,
            finalWpm: finite(p.result.wpm),
            accuracy: finite(p.result.acc),
            errorCount: p.result.errors,
            timelineData: {
              v: 1 as const,
              wpm: p.result.series.map(finite),
              rawWpm: finite(p.result.raw),
              consistency: finite(p.result.consistency),
              elapsedMs: p.result.elapsedMs,
              place: p.result.place,
            },
          })),
        )
        .onConflictDoNothing();
    });
  }

  async close(): Promise<void> {
    await this.closePool?.();
  }

  /**
   * Interim identity: until real sign-in exists, the handshake `playerId` is the user id, so a
   * profile row is created the first time a player is recorded. Existing rows are never renamed.
   */
  private async ensureUser(id: string, name: string): Promise<void> {
    if (this.known.has(id)) return;
    const existing = await this.db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
    if (existing.length === 0) {
      let created = false;
      for (const username of usernameCandidates(name, id)) {
        try {
          await this.db.insert(users).values({ id, username }).onConflictDoNothing({ target: users.id });
          created = true;
          break;
        } catch (err) {
          if (pgCode(err) !== "23505") throw err; // only "username taken" is retryable here
        }
      }
      if (!created) throw new Error(`could not allocate a username for ${id}`);
    }
    this.known.add(id);
  }
}

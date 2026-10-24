import { sql } from "drizzle-orm";
import {
  bigint,
  char,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/* ---------------------------------------------------------------------------
   Persistent data model. `users.id` is the player's identity: today the guest
   playerId from the socket handshake, later the verified auth user id (JWT `sub`).
   --------------------------------------------------------------------------- */

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(), // supplied by the identity source; no default
    username: varchar("username", { length: 16 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_username_lower_uq").on(sql`lower(${t.username})`), // case-insensitive unique
    check("users_username_format", sql`${t.username} ~ '^[A-Za-z0-9_-]{1,16}$'`),
  ],
);

export const matchReason = pgEnum("match_reason", ["finished", "forfeit"]);

export const matches = pgTable(
  "matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomCode: char("room_code", { length: 6 }).notNull(), // not unique: codes get reused
    player1Id: uuid("player1_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    player2Id: uuid("player2_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    winnerId: uuid("winner_id").references(() => users.id, { onDelete: "restrict" }), // null = no winner
    wordCount: smallint("word_count").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Enough to regenerate the exact text with shared/words.ts.
    seed: bigint("seed", { mode: "number" }).notNull(), // uint32 does not fit int4
    bankVersion: smallint("bank_version").notNull(),
    reason: matchReason("reason").notNull(),
    durationMs: integer("duration_ms"),
  },
  (t) => [
    check("matches_distinct_players", sql`${t.player1Id} <> ${t.player2Id}`),
    check(
      "matches_winner_is_player",
      sql`${t.winnerId} is null or ${t.winnerId} in (${t.player1Id}, ${t.player2Id})`,
    ),
    check("matches_word_count_pos", sql`${t.wordCount} > 0`),
    index("matches_p1_created_idx").on(t.player1Id, t.createdAt.desc()),
    index("matches_p2_created_idx").on(t.player2Id, t.createdAt.desc()),
    index("matches_room_code_idx").on(t.roomCode),
  ],
);

/** Versioned payload of `match_results.timeline_data`. */
export type TimelineData = {
  v: 1;
  /** WPM at the end of each second (index 0 = second 1). */
  wpm: number[];
  rawWpm: number;
  consistency: number;
  /** null = did not finish; their numbers are the last self-reported ones (unverified). */
  elapsedMs: number | null;
  place: 1 | 2;
};

export const matchResults = pgTable(
  "match_results",
  {
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    finalWpm: numeric("final_wpm", { precision: 6, scale: 2, mode: "number" }).notNull(),
    accuracy: numeric("accuracy", { precision: 5, scale: 2, mode: "number" }).notNull(),
    errorCount: integer("error_count").notNull(),
    timelineData: jsonb("timeline_data").$type<TimelineData>().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.matchId, t.userId] }),
    index("match_results_user_idx").on(t.userId),
    check(
      "match_results_sane",
      sql`${t.finalWpm} >= 0 and ${t.accuracy} between 0 and 100 and ${t.errorCount} >= 0`,
    ),
  ],
);

export type User = typeof users.$inferSelect;
export type Match = typeof matches.$inferSelect;
export type MatchResultRow = typeof matchResults.$inferSelect;

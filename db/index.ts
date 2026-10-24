import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export { schema };
export type Db = ReturnType<typeof createDb>["db"];

interface DbOptions {
  /** Max client connections. Keep small: the Neon pooler (PgBouncer) does the real pooling. */
  max?: number;
}

/**
 * Pooled Neon URL (host contains `-pooler`) for runtime; never use it for migrations.
 * All timeouts are bounded so a stalled database can never hang a caller indefinitely.
 */
export function createDb(connectionString: string, { max = 5 }: DbOptions = {}) {
  const pool = new Pool({
    connectionString,
    max,
    connectionTimeoutMillis: 5_000,
    query_timeout: 8_000,
    idleTimeoutMillis: 30_000,
    allowExitOnIdle: true,
  });
  // An idle client erroring (e.g. Neon scaling to zero) must not crash the process.
  pool.on("error", (err) => console.error("[db] idle client error:", err.message));
  return { db: drizzle(pool, { schema }), pool };
}

let shared: ReturnType<typeof createDb> | null = null;

/** Lazy process-wide client for the Next.js server side. Returns null when no DATABASE_URL is set. */
export function getDb(): Db | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  shared ??= createDb(url, { max: 3 });
  return shared.db;
}

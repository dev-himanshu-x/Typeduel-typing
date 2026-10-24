import { defineConfig } from "drizzle-kit";

// Migrations need a DIRECT (non-pooled) connection; the runtime uses the pooled DATABASE_URL.
try {
  process.loadEnvFile(".env.local");
} catch {
  /* env may already be set by the shell / CI */
}

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
// `generate` only diffs the schema against snapshots and never connects.
const needsDb = process.argv.some((a) => ["migrate", "push", "studio", "pull", "check"].includes(a));
if (needsDb && !url) {
  throw new Error("Set DATABASE_URL_UNPOOLED (direct Neon connection string) to run this command");
}

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: url ?? "postgres://unused@localhost/unused" },
});

import { createDb } from "../db";
import { createGameServer } from "./create-server";
import { PgMatchStore } from "./pg-match-store";

try {
  process.loadEnvFile(".env.local");
} catch {
  /* no .env.local: rely on the real environment */
}

const port = Number(process.env.PORT ?? 4000);
const clientOrigins = (process.env.CLIENT_ORIGIN ?? "http://localhost:3000")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const databaseUrl = process.env.DATABASE_URL;
const database = databaseUrl ? createDb(databaseUrl) : null;
if (!database) console.log("[server] DATABASE_URL not set: finished matches will not be persisted");

const server = createGameServer({
  port,
  clientOrigins,
  matchStore: database ? new PgMatchStore(database.db, () => database.pool.end()) : undefined,
});

// A bug in one handler or timer must not take every live room down with it.
process.on("uncaughtException", (err) => console.error("[server] uncaughtException:", err));
process.on("unhandledRejection", (err) => console.error("[server] unhandledRejection:", err));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`[server] ${signal}, shutting down`);
    server.close().finally(() => process.exit(0));
  });
}

server.listen().then(
  (p) => console.log(`[server] socket.io listening on :${p} (origins: ${clientOrigins.join(", ")})`),
  (err) => {
    console.error("[server] failed to start:", err);
    process.exit(1);
  },
);

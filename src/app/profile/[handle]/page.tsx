import type { Metadata } from "next";
import Link from "next/link";
import { MtShell } from "@/components/mt/mt-shell";
import { getDb } from "@db/index";
import {
  findUser,
  getHeadToHead,
  getHistory,
  getTotals,
  type HeadToHeadRow,
  type HistoryRow,
  type Totals,
} from "@db/queries";

export const dynamic = "force-dynamic"; // always read fresh results

export const metadata: Metadata = { title: "Profile | TypeDuel" };

const fmtDate = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
const fmtTime = (ms: number | null) => (ms === null ? "—" : `${(ms / 1000).toFixed(1)}s`);

export default async function ProfilePage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const db = getDb();

  if (!db) {
    return (
      <Shell>
        <Notice title="History is unavailable" body="The database isn't configured for this environment (DATABASE_URL is not set)." />
      </Shell>
    );
  }

  const user = await findUser(db, decodeURIComponent(handle));
  if (!user) {
    return (
      <Shell>
        <Notice
          title="No matches recorded yet"
          body="A profile appears after your first saved 1v1 match."
          action={{ href: "/versus", label: "Play a match" }}
        />
      </Shell>
    );
  }

  const [totals, headToHead, history] = await Promise.all([
    getTotals(db, user.id),
    getHeadToHead(db, user.id),
    getHistory(db, user.id),
  ]);

  return (
    <Shell>
      <header className="grid gap-1">
        <h1 className="text-2xl text-text" data-testid="profile-name">
          {user.username}
        </h1>
        <p className="text-sm text-text-muted">player since {user.createdAt.toISOString().slice(0, 10)}</p>
      </header>

      <Stats totals={totals} />
      <HeadToHead rows={headToHead} />
      <History rows={history} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <MtShell active="profile">
      <div className="mx-auto grid w-full max-w-4xl gap-8 pt-8 pb-8">{children}</div>
    </MtShell>
  );
}

function Notice({ title, body, action }: { title: string; body: string; action?: { href: string; label: string } }) {
  return (
    <section className="panel mx-auto grid max-w-md gap-3 text-center" role="status">
      <h1 className="text-xl">{title}</h1>
      <p className="text-sm text-text-muted">{body}</p>
      {action && (
        <Link href={action.href} className="btn btn-primary mx-auto">
          {action.label}
        </Link>
      )}
    </section>
  );
}

function Stats({ totals }: { totals: Totals }) {
  const decided = totals.wins + totals.losses;
  const winRate = decided === 0 ? "—" : `${Math.round((totals.wins / decided) * 100)}%`;
  const items = [
    { label: "matches", value: String(totals.matches) },
    { label: "record (W-L)", value: `${totals.wins}-${totals.losses}${totals.draws ? `-${totals.draws}` : ""}` },
    { label: "win rate", value: winRate },
    { label: "best wpm", value: totals.bestWpm ? String(Math.round(totals.bestWpm)) : "—" },
    { label: "avg accuracy", value: totals.matches ? `${Math.round(totals.avgAccuracy)}%` : "—" },
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5" data-testid="profile-stats">
      {items.map((s, i) => (
        <div
          key={s.label}
          className={`min-w-0 rounded border border-border bg-bg-elevated p-3 shadow-sm ${i === items.length - 1 ? "col-span-2 sm:col-span-1" : ""}`}
        >
          <dt className="text-xs text-text-muted">{s.label}</dt>
          <dd className={`mt-1 font-[family-name:var(--font-mono)] text-2xl ${i === 1 ? "text-cursor" : "text-text"}`}>{s.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function HeadToHead({ rows }: { rows: HeadToHeadRow[] }) {
  return (
    <section className="grid gap-3" aria-labelledby="h2h-title">
      <h2 id="h2h-title" className="text-lg">
        Head to head
      </h2>
      {rows.length === 0 ? (
        <p className="text-sm text-text-muted">No opponents yet.</p>
      ) : (
        <ul className="grid gap-2" data-testid="head-to-head">
          {rows.map((r) => (
            <li
              key={r.opponentId}
              className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 rounded border border-border bg-bg-elevated px-3 py-2 shadow-sm sm:grid-cols-[1fr_auto_auto]"
            >
              <Link href={`/profile/${r.opponentId}`} className="min-w-0 truncate text-text hover:text-cursor">
                {r.opponentName}
              </Link>
              <span className="text-right" aria-label={`${r.wins} wins, ${r.losses} losses`}>
                <span className="text-cursor">{r.wins}W</span> <span className="text-text-muted">·</span>{" "}
                <span>{r.losses}L</span>
                {r.draws > 0 && <span className="text-text-muted"> · {r.draws}D</span>}
              </span>
              <span className="col-span-2 text-xs text-text-muted sm:col-span-1 sm:text-right">
                {r.matches} {r.matches === 1 ? "match" : "matches"} · last {fmtDate(r.lastPlayed).slice(0, 10)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function History({ rows }: { rows: HistoryRow[] }) {
  const tone = { win: "text-cursor", loss: "text-text-muted", draw: "text-text" } as const;
  const label = { win: "WIN", loss: "LOSS", draw: "DRAW" } as const;
  return (
    <section className="grid gap-3" aria-labelledby="history-title">
      <h2 id="history-title" className="text-lg">
        Match history
      </h2>
      {rows.length === 0 ? (
        <p className="text-sm text-text-muted">No matches yet.</p>
      ) : (
        <ul className="grid gap-2" data-testid="match-history">
          {rows.map((r) => (
            <li
              key={r.matchId}
              className="grid grid-cols-[3.5rem_1fr_auto] items-center gap-x-3 gap-y-1 rounded border border-border bg-bg-elevated px-3 py-2 shadow-sm"
            >
              <span className={`text-sm ${tone[r.outcome]}`}>{label[r.outcome]}</span>
              <span className="min-w-0 truncate">
                <span className="text-text-muted">vs </span>
                <Link href={`/profile/${r.opponentId}`} className="text-text hover:text-cursor">
                  {r.opponentName}
                </Link>
                {r.reason === "forfeit" && <span className="ml-2 text-xs text-text-muted">(forfeit)</span>}
              </span>
              <span className="text-right">
                <span className="font-[family-name:var(--font-mono)] text-text">{Math.round(r.wpm)}</span>
                <span className="text-xs text-text-muted"> wpm</span>
                {r.opponentWpm !== null && (
                  <span className="text-xs text-text-muted"> · {Math.round(r.opponentWpm)}</span>
                )}
              </span>
              <span className="col-span-3 flex flex-wrap gap-x-4 text-xs text-text-muted">
                <span>{fmtDate(r.playedAt)}</span>
                <span>{Math.round(r.accuracy)}% acc</span>
                <span>{r.errors} errors</span>
                <span>{r.finished ? fmtTime(r.durationMs) : "did not finish"}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import type { MatchResult, MatchResultPlayer } from "@shared/protocol";
import type { ChartPoint } from "./wpm-chart";

// recharts is only needed once a race ends, so keep it out of the main versus bundle.
const WpmChart = dynamic(() => import("./wpm-chart"), {
  ssr: false,
  loading: () => <div className="h-full w-full" aria-hidden />,
});

interface ResultsBreakdownProps {
  result: MatchResult;
  meId: string;
}

const pad = (series: number[], length: number) =>
  Array.from({ length }, (_, i) => series[i] ?? series[series.length - 1] ?? 0);

/** One point per second; the shorter series is padded with its last value. */
export function buildChartData(you: MatchResultPlayer, opponent: MatchResultPlayer | undefined): ChartPoint[] {
  const length = Math.max(you.series.length, opponent?.series.length ?? 0);
  const a = pad(you.series, length);
  const b = opponent ? pad(opponent.series, length) : null;
  return a.map((v, i) => ({ sec: i + 1, you: v, opponent: b ? b[i] : null }));
}

const formatTime = (ms: number | null) => (ms === null ? "DNF" : `${Math.round(ms / 1000)}s`);

export function ResultsBreakdown({ result, meId }: ResultsBreakdownProps) {
  const you = result.players.find((p) => p.playerId === meId);
  const opponent = result.players.find((p) => p.playerId !== meId);
  const data = useMemo(() => (you ? buildChartData(you, opponent) : []), [you, opponent]);
  if (!you) return null;

  const hasChart = data.length >= 2;
  const consistency = (p: MatchResultPlayer) => (p.series.length < 2 ? "—" : `${Math.round(p.consistency)}%`);

  const cards: { label: string; you: string; opp?: string; hero?: boolean }[] = [
    { label: "wpm", you: String(Math.round(you.wpm)), opp: opponent && String(Math.round(opponent.wpm)), hero: true },
    { label: "raw wpm", you: String(Math.round(you.raw)), opp: opponent && String(Math.round(opponent.raw)) },
    { label: "accuracy", you: `${Math.round(you.acc)}%`, opp: opponent && `${Math.round(opponent.acc)}%` },
    { label: "consistency", you: consistency(you), opp: opponent && consistency(opponent) },
    { label: "errors", you: String(you.errors), opp: opponent && String(opponent.errors) },
  ];

  return (
    <div className="grid gap-5" data-testid="results-breakdown">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {cards.map((c, i) => (
          <div
            key={c.label}
            className={`min-w-0 rounded border border-border bg-bg-elevated p-3 shadow-sm ${i === cards.length - 1 ? "col-span-2 sm:col-span-1" : ""}`}
            data-testid={`metric-${c.label.replace(" ", "-")}`}
          >
            <dt className="text-xs text-text-muted">{c.label}</dt>
            <dd className={`mt-1 font-[family-name:var(--font-mono)] text-3xl ${c.hero ? "text-series-a" : "text-text"}`}>{c.you}</dd>
            {opponent && (
              <dd className="mt-2 flex items-center gap-1.5 text-xs text-text-muted">
                <span className="size-2 shrink-0 rounded-full bg-series-b" aria-hidden />
                <span className="min-w-0 truncate">{opponent.name}</span>
                <span className="ml-auto text-text">{c.opp}</span>
              </dd>
            )}
          </div>
        ))}
      </dl>

      <section aria-label="WPM over time" className="grid gap-2">
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted" aria-label="Legend">
          <LegendItem color="bg-series-a" label={`${you.name} (you)`} />
          {opponent && <LegendItem color="bg-series-b" label={opponent.name} />}
          <li className="ml-auto">wpm per second</li>
        </ul>
        <div
          className="h-48 w-full sm:h-64"
          role="img"
          aria-label={`Line chart of words per minute each second. You ended at ${Math.round(you.wpm)} wpm${
            opponent ? `, ${opponent.name} at ${Math.round(opponent.wpm)} wpm` : ""
          }.`}
          data-testid="wpm-chart"
        >
          {hasChart ? (
            <WpmChart data={data} youName={you.name} opponentName={opponent?.name ?? null} />
          ) : (
            <p className="grid h-full place-items-center text-sm text-text-muted">The race was too short for a chart.</p>
          )}
        </div>
      </section>

      <p className="text-xs text-text-muted" data-testid="finish-times">
        time · <span className="text-text">{you.name}</span> {formatTime(you.elapsedMs)}
        {opponent && (
          <>
            {" · "}
            <span className="text-text">{opponent.name}</span> {formatTime(opponent.elapsedMs)}
          </>
        )}
      </p>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <li className="flex min-w-0 items-center gap-2">
      <span className={`h-0.5 w-5 shrink-0 rounded-full ${color}`} aria-hidden />
      <span className="truncate">{label}</span>
    </li>
  );
}

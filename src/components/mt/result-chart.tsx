"use client";

import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import type { ChartRow } from "./result-data";

const AXIS = { fill: "var(--text-muted)", fontSize: 12 } as const;

function ErrorMark(props: { cx?: number; cy?: number; payload?: ChartRow }) {
  const { cx = 0, cy = 0, payload } = props;
  if (!payload || payload.err === null) return <g />; // no errors this second: draw nothing
  return (
    <path
      d={`M${cx - 3.5} ${cy - 3.5}l7 7m0-7l-7 7`}
      stroke="var(--typing-incorrect)"
      strokeWidth={2}
      strokeLinecap="round"
      fill="none"
    />
  );
}

/** Round tick values like Monkeytype's axis (0, 100, 200...). */
function niceTicks(max: number): number[] {
  const step = max <= 100 ? 25 : max <= 200 ? 50 : 100;
  const top = Math.ceil((max * 1.1) / step) * step;
  return Array.from({ length: top / step + 1 }, (_, i) => i * step);
}

/** Monkeytype's result graph: wpm (main), raw (sub) and an error marker per second on a right-hand axis. */
export default function ResultChart({ rows }: { rows: ChartRow[] }) {
  const maxErr = Math.max(1, ...rows.map((r) => r.err ?? 0));
  const ticks = niceTicks(Math.max(1, ...rows.map((r) => Math.max(r.wpm, r.raw))));
  return (
    <div className="relative h-full w-full">
      {/* Axis titles drawn by hand: chart-library labels get clipped in a 200px-high plot. */}
      <span className="pointer-events-none absolute top-1/2 -left-[64px] w-[160px] -translate-y-1/2 -rotate-90 text-center text-xs text-sub">
        Words per Minute
      </span>
      <span className="pointer-events-none absolute top-1/2 -right-[22px] w-[60px] -translate-y-1/2 rotate-90 text-center text-xs text-sub">
        Errors
      </span>
      <div className="h-full pr-6 pl-7">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 12, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--chart-grid)" strokeOpacity={0.18} />
            <XAxis dataKey="sec" tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis
              yAxisId="wpm"
              width={34}
              tick={AXIS}
              tickLine={false}
              axisLine={false}
              ticks={ticks}
              domain={[0, ticks[ticks.length - 1]]}
            />
            <YAxis yAxisId="err" orientation="right" width={0} tick={false} tickLine={false} axisLine={false} domain={[0, maxErr + 1]} />
            <Tooltip
              cursor={{ stroke: "var(--chart-grid)", strokeOpacity: 0.4 }}
              contentStyle={{
                background: "var(--bg-elevated)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                boxShadow: "var(--shadow-md)",
                color: "var(--text)",
                fontSize: 12,
              }}
              labelStyle={{ color: "var(--text-muted)" }}
              labelFormatter={(v) => `second ${v}`}
              formatter={(value, name) => [Math.round(Number(value)), name === "err" ? "errors" : name]}
            />
            <Line yAxisId="wpm" type="monotone" dataKey="raw" name="raw" stroke="var(--text-muted)" strokeWidth={2} dot={{ r: 2, fill: "var(--text-muted)", strokeWidth: 0 }} isAnimationActive={false} />
            <Line yAxisId="wpm" type="monotone" dataKey="wpm" name="wpm" stroke="var(--typing-cursor)" strokeWidth={3} dot={{ r: 3, fill: "var(--typing-cursor)", strokeWidth: 0 }} isAnimationActive={false} />
            <Scatter yAxisId="err" dataKey="err" name="err" shape={<ErrorMark />} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

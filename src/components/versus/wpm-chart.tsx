"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface ChartPoint {
  sec: number;
  you: number;
  opponent: number | null;
}

interface WpmChartProps {
  data: ChartPoint[];
  youName: string;
  opponentName: string | null;
}

const AXIS = { fill: "var(--text-muted)", fontSize: 12 } as const;

/** Dual-line WPM-over-time chart. Colours come from the design tokens (series-a/b, chart-grid). */
export default function WpmChart({ data, youName, opponentName }: WpmChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
        <CartesianGrid stroke="var(--chart-grid)" strokeOpacity={0.35} strokeDasharray="3 3" />
        <XAxis
          dataKey="sec"
          tick={AXIS}
          tickLine={false}
          axisLine={{ stroke: "var(--chart-grid)", strokeOpacity: 0.6 }}
          tickFormatter={(v: number) => `${v}s`}
          interval="preserveStartEnd"
          minTickGap={16}
        />
        <YAxis
          tick={AXIS}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
          domain={[0, "auto"]}
          width={48}
        />
        <Tooltip
          cursor={{ stroke: "var(--chart-grid)", strokeOpacity: 0.6 }}
          contentStyle={{
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            boxShadow: "var(--shadow-md)",
            color: "var(--text)",
            fontSize: 12,
          }}
          labelStyle={{ color: "var(--text-muted)" }}
          labelFormatter={(v) => `${v}s`}
          formatter={(value, name) => [`${Math.round(Number(value))} wpm`, name]}
        />
        <Line
          type="monotone"
          dataKey="you"
          name={youName}
          stroke="var(--series-a)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: "var(--series-a)", stroke: "var(--bg-elevated)" }}
          animationDuration={500}
        />
        {opponentName && (
          <Line
            type="monotone"
            dataKey="opponent"
            name={opponentName}
            stroke="var(--series-b)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: "var(--series-b)", stroke: "var(--bg-elevated)" }}
            animationDuration={500}
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}

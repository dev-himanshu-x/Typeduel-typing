import type { TestResult } from "@/components/typing-engine";

/** Kept out of result-chart.tsx so importing it never pulls the chart library into the main bundle. */
export interface ChartRow {
  sec: number;
  wpm: number;
  raw: number;
  err: number | null; // errors made in this second (null = none, so no marker)
}

export const toRows = (r: TestResult): ChartRow[] =>
  r.perSecond.wpm.map((wpm, i) => ({
    sec: i + 1,
    wpm,
    raw: r.perSecond.raw[i] ?? 0,
    err: (r.perSecond.errors[i] ?? 0) > 0 ? r.perSecond.errors[i] : null,
  }));

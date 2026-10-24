"use client";

import dynamic from "next/dynamic";
import { useMemo, type ReactNode } from "react";
import { FaAlignLeft, FaBackward, FaChevronRight, FaExclamationTriangle, FaRegImage, FaSyncAlt } from "react-icons/fa";
import type { TestResult } from "@/components/typing-engine";
import { toRows } from "./result-data";

const ResultChart = dynamic(() => import("./result-chart"), { ssr: false, loading: () => <div className="h-full" aria-hidden /> });

const pad = (n: number) => String(n).padStart(2, "0");
const session = (sec: number) => `${pad(Math.floor(sec / 3600))}:${pad(Math.floor((sec % 3600) / 60))}:${pad(sec % 60)}`;

function ResultButton({
  label,
  onClick,
  children,
  testId,
}: {
  label: string;
  onClick?: () => void;
  children: ReactNode;
  testId?: string;
}) {
  const live = !!onClick;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!live}
      aria-label={label}
      title={live ? label : `${label}: not available yet`}
      data-testid={testId}
      className={`inline-flex items-center justify-center rounded-pill px-[2em] py-[1em] text-sub transition-colors duration-125 focus-visible:text-text focus-visible:outline-none ${
        live ? "cursor-pointer hover:bg-bg-elevated hover:text-text" : "cursor-default"
      }`}
    >
      {children}
    </button>
  );
}

/** Monkeytype's post-test summary. */
export function ResultScreen({
  result,
  onNext,
  onRepeat,
}: {
  result: TestResult;
  onNext: () => void;
  onRepeat: () => void;
}) {
  const rows = useMemo(() => toRows(result), [result]);
  const c = result.chars;
  return (
    <div className="w-full" id="result" data-testid="result-screen">
      <div className="panel mb-4 grid gap-6 md:grid-cols-[auto_1fr]">
        <div className="grid items-center justify-center gap-4 sm:grid-cols-2 md:grid-cols-1">
          <div className="font-[family-name:var(--font-mono)]">
            <div className="flex items-center leading-[0.5em] text-sub">wpm</div>
            <div className="text-[2.5em] leading-[1.25] text-main" data-testid="result-wpm" title={`${result.wpm.toFixed(2)} wpm`}>
              {Math.round(result.wpm)}
            </div>
          </div>
          <div className="font-[family-name:var(--font-mono)]">
            <div className="leading-[0.5em] text-sub">acc</div>
            <div className="text-[2.5em] leading-[1.25] text-main" data-testid="result-acc" title={`${result.acc.toFixed(2)}%`}>
              {Math.round(result.acc)}%
            </div>
          </div>
        </div>
        <div className="h-50 w-full rounded bg-bg p-2" data-testid="result-chart">
          <ResultChart rows={rows} />
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 items-start gap-3 sm:grid-flow-col sm:grid-cols-none sm:justify-between">
        <Stat label="test type">
          <div className="text-main">
            time {result.durationSec}
            <br />
            english
          </div>
        </Stat>
        <Stat label="raw" big>
          {Math.round(result.raw)}
        </Stat>
        <Stat label="characters" big title="correct / incorrect / extra / missed">
          {c.correct}/{c.incorrect}/{c.extra}/{c.missed}
        </Stat>
        <Stat label="consistency" big>
          {Math.round(result.consistency)}%
        </Stat>
        <Stat label="time" big>
          {result.durationSec}s
          <div className="ml-[0.2rem] text-[0.75rem] leading-[0.75rem] text-sub">{session(result.durationSec)} session</div>
        </Stat>
      </div>

      <div className="grid grid-flow-col justify-center gap-2 max-sm:grid-flow-row max-sm:grid-cols-2">
        <ResultButton label="Next test" onClick={onNext} testId="next-test">
          <FaChevronRight size={20} aria-hidden />
        </ResultButton>
        <ResultButton label="Repeat test" onClick={onRepeat} testId="repeat-test">
          <FaSyncAlt size={20} aria-hidden />
        </ResultButton>
        <ResultButton label="Practice words">
          <FaExclamationTriangle size={20} aria-hidden />
        </ResultButton>
        <ResultButton label="Word history">
          <FaAlignLeft size={20} aria-hidden />
        </ResultButton>
        <ResultButton label="Watch replay">
          <FaBackward size={20} aria-hidden />
        </ResultButton>
        <ResultButton label="Save screenshot">
          <FaRegImage size={20} aria-hidden />
        </ResultButton>
      </div>
    </div>
  );
}

function Stat({ label, children, big, title }: { label: string; children: ReactNode; big?: boolean; title?: string }) {
  return (
    <div title={title} className="rounded border border-border bg-bg-elevated px-3 py-2.5">
      <div className="text-sub">{label}</div>
      <div className={big ? "font-[family-name:var(--font-mono)] text-[1.75em] leading-[1.3em] text-main" : ""}>{children}</div>
    </div>
  );
}

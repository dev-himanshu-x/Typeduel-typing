"use client";

import type { ReactNode } from "react";
import { FaAt, FaClock, FaFont, FaHashtag, FaMountain, FaQuoteLeft, FaTools, FaWrench } from "react-icons/fa";
import { DURATIONS } from "@shared/protocol";
import { useTestFocus } from "./mt-shell";

/* Test configuration: a row of segmented-pill cards. Only "time" mode and its lengths work
   today; the other controls are drawn in the same style but are inert (and marked as unavailable). */

const card = "pill-surface flex h-[42px] items-center gap-0.5 px-1.5 text-[12px] leading-none";
const btn =
  "inline-flex h-[32px] items-center justify-center gap-[6px] rounded-pill px-3 whitespace-nowrap transition-colors duration-125";

function Inert({ children, label }: { children: ReactNode; label: string }) {
  return (
    <span className={`${btn} cursor-default text-sub`} title={`${label}: not available yet`} aria-disabled="true">
      {children}
    </span>
  );
}

export function ConfigBar({
  duration,
  onDuration,
  disabled = false,
  title,
}: {
  duration: number;
  onDuration: (seconds: number) => void;
  /** e.g. only the host may change the length in a room. */
  disabled?: boolean;
  title?: string;
}) {
  const { focus } = useTestFocus();
  return (
    <div
      className={`flex flex-wrap justify-center gap-3 transition-opacity duration-125 ${
        focus ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
      aria-label="Test configuration"
      data-testid="config-bar"
    >
      <div className={card}>
        <Inert label="Punctuation">
          <FaAt aria-hidden size={15} /> punctuation
        </Inert>
        <Inert label="Numbers">
          <FaHashtag aria-hidden size={15} /> numbers
        </Inert>
      </div>

      <div className={card}>
        <span className={`${btn} bg-accent text-on-accent`} aria-current="true">
          <FaClock aria-hidden size={15} /> time
        </span>
        <Inert label="Words">
          <FaFont aria-hidden size={15} /> words
        </Inert>
        <Inert label="Quote">
          <FaQuoteLeft aria-hidden size={15} /> quote
        </Inert>
        <Inert label="Zen">
          <FaMountain aria-hidden size={15} /> zen
        </Inert>
        <Inert label="Custom">
          <FaWrench aria-hidden size={15} /> custom
        </Inert>
      </div>

      <div className={card} title={title}>
        {DURATIONS.map((d) => (
          <button
            key={d}
            type="button"
            disabled={disabled}
            onClick={() => onDuration(d)}
            aria-pressed={d === duration}
            data-testid={`duration-${d}`}
            className={`${btn} font-[family-name:var(--font-mono)] ${disabled ? "cursor-not-allowed" : "cursor-pointer"} ${
              d === duration ? "bg-accent text-on-accent" : disabled ? "text-sub" : "text-sub hover:text-text"
            }`}
          >
            {d}
          </button>
        ))}
        <Inert label="Custom time">
          <FaTools aria-hidden size={15} />
        </Inert>
      </div>
    </div>
  );
}

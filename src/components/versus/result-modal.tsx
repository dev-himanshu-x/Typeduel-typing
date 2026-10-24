"use client";

import { useEffect, useRef, useState } from "react";
import type { MatchResult } from "@shared/protocol";
import Link from "next/link";
import type { SaveStatus } from "@/hooks/use-room";
import { ResultsBreakdown } from "./results-breakdown";

interface ResultModalProps {
  result: MatchResult;
  meId: string;
  roomCode: string;
  saveStatus: SaveStatus;
  profileHref: string;
  meReady: boolean;
  opponentName?: string;
  opponentReady: boolean;
  opponentPresent: boolean;
  onRematch: () => void;
  onLeave: () => void;
}

export function ResultModal({
  result,
  meId,
  roomCode,
  saveStatus,
  profileHref,
  meReady,
  opponentName,
  opponentReady,
  opponentPresent,
  onRematch,
  onLeave,
}: ResultModalProps) {
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const primaryRef = useRef<HTMLButtonElement>(null);
  // Focus the primary action without scrolling the (possibly scrollable) modal down to it.
  useEffect(() => primaryRef.current?.focus({ preventScroll: true }), []);
  const won = result.winnerId === meId;

  const headline = won ? "You won" : result.winnerId === null ? "Match over" : "You lost";
  const sub =
    result.reason === "forfeit"
      ? won
        ? "Your opponent disconnected or left. You win by forfeit."
        : "The race ended by forfeit."
      : won
        ? "You finished first."
        : "Your opponent finished first.";

  // There is no stored match yet, so the link is the room's invite link.
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/versus/${roomCode}`);
      setCopy("copied");
    } catch {
      setCopy("failed");
    }
    setTimeout(() => setCopy("idle"), 1800);
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        className="modal max-w-3xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="result-title"
        data-testid="result-modal"
      >
        <div className="modal-header">
          <h2 id="result-title" className={`text-xl ${won ? "text-cursor" : "text-text"}`}>
            {headline}
          </h2>
          <p className="text-sm text-text-muted">{sub}</p>
        </div>

        <div className="modal-body">
          <ResultsBreakdown result={result} meId={meId} />
        </div>

        <div className="modal-footer sticky bottom-0 flex-wrap bg-bg-elevated">
          <p className="mr-auto basis-full text-xs text-text-muted sm:basis-auto" aria-live="polite">
            {!opponentPresent ? (
              "Your opponent has left."
            ) : opponentReady && !meReady ? (
              <span className="text-cursor" data-testid="rematch-notice">
                {opponentName ?? "Your opponent"} wants a rematch.
              </span>
            ) : meReady ? (
              "Waiting for your opponent to accept…"
            ) : (
              ""
            )}
            {saveStatus === "pending" && <span data-testid="save-status"> Saving to match history…</span>}
            {saveStatus === "saved" && (
              <span data-testid="save-status">
                {" "}
                Saved to match history ·{" "}
                <Link href={profileHref} className="text-text underline">
                  view profile
                </Link>
              </span>
            )}
            {saveStatus === "failed" && (
              <span data-testid="save-status" className="text-incorrect">
                {" "}
                Couldn&apos;t save this match.
              </span>
            )}
          </p>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onLeave} data-testid="result-leave">
            Leave room
          </button>
          <button type="button" className="btn btn-secondary" onClick={copyLink} data-testid="copy-match-link">
            {copy === "copied" ? "Link copied" : copy === "failed" ? "Couldn't copy" : "Copy Match Link"}
          </button>
          <button
            type="button"
            className={`btn ${meReady ? "btn-secondary" : "btn-primary"}`}
            onClick={onRematch}
            data-testid="rematch"
            ref={primaryRef}
          >
            {meReady ? "Cancel rematch" : opponentReady ? "Accept Rematch" : "Play Again"}
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { DEFAULT_DURATION_SEC } from "@shared/protocol";
import { ConfigBar } from "@/components/mt/config-bar";
import { TestArea } from "@/components/mt/mt-shell";
import { TypingEngine, type EngineProgress } from "@/components/typing-engine";
import { useRoom, type ConnState } from "@/hooks/use-room";
import { Lobby } from "./lobby";
import { ResultModal } from "./result-modal";

/** 1v1 race, rendered inside the shared Monkeytype-style page frame (see MtShell). */
export function VersusGame({ initialCode }: { initialCode?: string }) {
  const g = useRoom();
  const { room, race, go, result, identity } = g;

  const meId = identity?.playerId ?? null;
  const me = room?.players.find((p) => p.id === meId);
  const opponent = room?.players.find((p) => p.id !== meId);
  const showRace = !!(room && race && room.status !== "waiting");
  const usable = g.conn === "connected";
  const isHost = !!room && room.hostId === meId;

  return (
    <>
      {/* Race length: the host picks it in the lobby (same bar as the solo test). Hidden during a race. */}
      <div className="relative">
        <div className={showRace ? "pointer-events-none opacity-0" : ""}>
          <ConfigBar
            duration={room?.durationSec ?? DEFAULT_DURATION_SEC}
            onDuration={(d) => void g.configure(d)}
            disabled={!room || !isHost || !usable}
            title={!room ? "Create or join a room first" : isHost ? undefined : "Only the host can change the race length"}
          />
        </div>
        <div className="absolute top-1/2 right-0 hidden -translate-y-1/2 text-xs text-sub xl:block">
          <ConnectionChip conn={g.conn} error={g.connError} />
        </div>
      </div>
      <div className="mt-2 text-center text-xs text-sub xl:hidden">
        <ConnectionChip conn={g.conn} error={g.connError} centered />
      </div>

      <TestArea>
        {g.conn === "replaced" ? (
          <section className="panel mx-auto grid max-w-md gap-3 text-center" role="alert">
            <h1 className="text-xl">Opened somewhere else</h1>
            <p className="text-sm text-sub">This player is now active in another tab, so this one was disconnected.</p>
            <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
              Use this tab
            </button>
          </section>
        ) : showRace && room && race ? (
          <div className="grid w-full gap-2">
            {!race.checksumOk ? (
              <section className="panel mx-auto text-center" role="alert">
                <p className="text-incorrect">Your word list doesn&apos;t match the server&apos;s.</p>
                <p className="text-sm text-sub">Refresh the page to load the latest version.</p>
              </section>
            ) : (
              <>
                <RaceHeader
                  code={room.code}
                  opponentName={opponent?.name}
                  startsAt={race.startsAt}
                  racing={!!go}
                  over={!!result}
                  serverNow={g.serverNow}
                  paused={result ? null : room.paused}
                  awayNames={room.players.filter((p) => room.paused?.playerIds.includes(p.id)).map((p) => (p.id === meId ? "You" : p.name))}
                />
                <TypingEngine
                  key={`${room.code}:${race.seed}`}
                  words={race.words}
                  durationSec={race.durationSec}
                  locked={!go || !!result || !!room.paused}
                  frozen={!!room.paused}
                  timeUpSignal={g.timeUp}
                  clockStartMs={go?.perfStart}
                  opponent={
                    opponent
                      ? {
                          name: opponent.name,
                          wordIndex: g.opponent?.wordIndex ?? 0,
                          charIndex: g.opponent?.charIndex ?? 0,
                        }
                      : null
                  }
                  onProgress={(p: EngineProgress) => g.sendProgress(p)}
                  onFinish={(payload) => void g.sendFinish(payload)}
                />
              </>
            )}
          </div>
        ) : (
          <Lobby
            room={room}
            meId={meId}
            initialName={identity?.name ?? ""}
            initialCode={initialCode}
            disabled={!usable}
            onCreate={g.create}
            onJoin={g.join}
            onReady={g.setReady}
            onLeave={g.leave}
            key={identity ? "ready" : "loading"} // re-init the name field once the saved identity loads
          />
        )}
      </TestArea>

      {room && result && meId && (
        <ResultModal
          result={result}
          meId={meId}
          roomCode={room.code}
          saveStatus={g.saveStatus}
          profileHref={`/profile/${meId}`}
          meReady={!!me?.ready}
          opponentName={opponent?.name}
          opponentReady={!!opponent?.ready}
          opponentPresent={!!opponent}
          onRematch={() => void g.setReady(!me?.ready)}
          onLeave={() => void g.leave()}
        />
      )}
    </>
  );
}

function RaceHeader({
  code,
  opponentName,
  startsAt,
  racing,
  over,
  serverNow,
  paused,
  awayNames,
}: {
  code: string;
  opponentName?: string;
  startsAt: number;
  racing: boolean;
  over: boolean;
  serverNow: () => number;
  paused: { until: number; graceMs: number; playerIds: string[] } | null;
  awayNames: string[];
}) {
  const [now, setNow] = useState<number | null>(null);
  const ticking = !racing || !!paused;

  // A display ticker only; the actual GO / forfeit decisions come from the server.
  useEffect(() => {
    if (!ticking) return;
    const tick = () => setNow(serverNow());
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [ticking, serverNow]);

  const secondsLeft = (t: number) => (now === null ? null : Math.max(0, Math.ceil((t - now) / 1000)));
  const remaining = secondsLeft(paused ? paused.until : startsAt);
  const label = over
    ? "finished"
    : paused
      ? String(remaining === null ? "" : Math.min(remaining, Math.ceil(paused.graceMs / 1000)))
      : racing
        ? "go!"
        : remaining === null
          ? ""
          : String(Math.min(3, Math.max(1, remaining))); // clock-sync jitter must not show "4" for a 3s countdown
  const accent = paused || !racing || over;

  return (
    <div className="grid gap-1 text-center">
      <p className="truncate text-xs text-text-muted">
        room <span className="tracking-widest">{code}</span>
        {opponentName ? ` · vs ${opponentName}` : ""}
      </p>
      <p
        className={`flex h-14 items-center justify-center text-5xl ${accent ? "text-cursor" : "text-text-muted"}`}
        role="status"
        aria-live="assertive"
        data-testid="countdown"
        data-paused={paused ? "true" : undefined}
      >
        {label}
      </p>
      {/* Reserved line so the pause banner never shifts the layout. */}
      <p className="h-5 text-sm text-incorrect" role="status" data-testid="pause-banner">
        {paused && !over
          ? `${awayNames.join(" and ")} disconnected. Race paused, reconnecting…`
          : ""}
      </p>
    </div>
  );
}

function ConnectionChip({ conn, error, centered }: { conn: ConnState; error: string | null; centered?: boolean }) {
  const view: Record<ConnState, { text: string; dot: string }> = {
    connecting: { text: "connecting…", dot: "bg-text-muted" },
    connected: { text: "connected", dot: "bg-cursor" },
    reconnecting: { text: "reconnecting…", dot: "bg-incorrect animate-pulse" },
    error: { text: error ?? "can't reach server", dot: "bg-incorrect" },
    replaced: { text: "disconnected", dot: "bg-incorrect" },
  };
  const v = view[conn];
  return (
    <p className={`flex min-w-0 items-center gap-2 ${centered ? "justify-center" : ""}`} role="status" data-testid="connection" data-state={conn}>
      <span className={`size-2 shrink-0 rounded-full ${v.dot}`} aria-hidden />
      <span className="truncate">{conn === "reconnecting" && error ? `${v.text} (${error})` : v.text}</span>
    </p>
  );
}

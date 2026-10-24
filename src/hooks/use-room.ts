"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import {
  EVENTS,
  type Ack,
  type CountdownPayload,
  type Identity,
  type MatchResult,
  type OpponentProgress,
  type RaceFinishPayload,
  type RaceProgress,
  type RaceResumedPayload,
  type RaceStartPayload,
  type RoomSnapshot,
} from "@shared/protocol";
import { generateWords, wordsChecksum } from "@shared/words";
import { measureClockOffset } from "@/lib/clock-sync";
import { createSocket, loadIdentity, saveName } from "@/lib/socket";

export type SaveStatus = "idle" | "pending" | "saved" | "failed";

export type ConnState = "connecting" | "connected" | "reconnecting" | "error" | "replaced";

export interface RaceInfo {
  seed: number;
  durationSec: number;
  words: string[];
  /** False when the locally generated words don't match the server's checksum (stale client). */
  checksumOk: boolean;
  startsAt: number; // server epoch ms
}

const failAck = (message: string): Ack<never> => ({ ok: false, error: { code: "INTERNAL", message } });

/** Socket.IO room lifecycle: connection, lobby, countdown, race stream and result. */
export function useRoom() {
  const socketRef = useRef<Socket | null>(null);
  const identityRef = useRef<Identity | null>(null);
  const offsetRef = useRef(0); // serverNow ≈ Date.now() + offset
  const seqRef = useRef(0);
  const goTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const goneRef = useRef(false);
  const seedRef = useRef<number | null>(null); // seed of the race currently on screen
  const gotStateRef = useRef(false); // room:state seen since the last (re)connect

  const [identity, setIdentity] = useState<Identity | null>(null);
  const [conn, setConn] = useState<ConnState>("connecting");
  const [connError, setConnError] = useState<string | null>(null);
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [race, setRace] = useState<RaceInfo | null>(null);
  /** Set at GO: `perfStart` is the performance.now() timestamp the race clock started. */
  const [go, setGo] = useState<{ perfStart: number } | null>(null);
  const [opponent, setOpponent] = useState<OpponentProgress | null>(null);
  const [result, setResult] = useState<MatchResult | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  /** The server announced that time is up (our own clock may be slightly behind). */
  const [timeUp, setTimeUp] = useState(false);

  const serverNow = useCallback(() => Date.now() + offsetRef.current, []);

  useEffect(() => {
    const id = loadIdentity();
    identityRef.current = id;
    setIdentity(id);
    const socket = createSocket(id);
    socketRef.current = socket;
    goneRef.current = false;

    const clearGoTimer = () => {
      if (goTimer.current) clearTimeout(goTimer.current);
      goTimer.current = null;
    };
    const resetRace = () => {
      clearGoTimer();
      setRace(null);
      setGo(null);
      setOpponent(null);
      setResult(null);
      setSaveStatus("idle");
      setTimeUp(false);
      seedRef.current = null;
    };
    const triggerGo = (startsAt: number) => {
      clearGoTimer();
      setGo((prev) => prev ?? { perfStart: performance.now() - Math.max(0, serverNow() - startsAt) });
    };

    socket.on("connect", () => {
      setConn("connected");
      setConnError(null);
      // The server re-pushes `room:state` right after (re)connect if we still hold a seat. Keep what is
      // on screen (typed text included) for a moment so a brief network blip doesn't wipe the race;
      // if no state arrives, the server no longer knows us (e.g. it restarted), so drop the stale room.
      gotStateRef.current = false;
      setTimeout(() => {
        if (goneRef.current || gotStateRef.current || !socket.connected) return;
        setRoom(null);
        resetRace();
      }, 1500);
      void measureClockOffset(socket).then((offset) => {
        if (offset !== null) offsetRef.current = offset;
      });
    });

    socket.on("disconnect", (reason) => {
      if (goneRef.current) return;
      // "io server disconnect" = the server kicked us (e.g. replaced by another tab): don't retry.
      setConn((c) => (c === "replaced" || reason === "io server disconnect" ? "replaced" : "reconnecting"));
    });

    socket.on("connect_error", (err: Error & { data?: { message?: string } }) => {
      setConn(socket.active ? "reconnecting" : "error");
      setConnError(err.data?.message ?? "Can't reach the game server");
    });

    socket.on(EVENTS.sessionReplaced, () => setConn("replaced"));

    socket.on(EVENTS.roomState, (state: RoomSnapshot) => {
      gotStateRef.current = true;
      setRoom(state);
      if (state.status === "waiting") resetRace();
      if (state.result) setResult(state.result);
    });

    socket.on(EVENTS.raceCountdown, (p: CountdownPayload) => {
      // The same seed again = we reconnected mid-race: keep the engine (and what was typed) mounted.
      const sameRace = seedRef.current === p.seed;
      seedRef.current = p.seed;
      // Fallback offset until the dedicated clock sync has answered.
      if (offsetRef.current === 0) offsetRef.current = p.serverNowMs - Date.now();
      setRace((prev) => {
        if (sameRace && prev) return { ...prev, startsAt: p.startsAt };
        const words = generateWords(p.seed, p.wordCount, p.bankVersion);
        return { seed: p.seed, durationSec: p.durationSec, words, checksumOk: wordsChecksum(words) === p.checksum, startsAt: p.startsAt };
      });
      setGo(null);
      if (!sameRace) {
        setTimeUp(false);
        setOpponent(null);
        setResult(null);
        setSaveStatus("idle");
        seqRef.current = 0; // a fresh race restarts the sequence; a resumed one must keep counting
      }
      clearGoTimer();
      goTimer.current = setTimeout(() => triggerGo(p.startsAt), Math.max(0, p.startsAt - serverNow()));
    });

    // Authoritative GO from the server; whichever of this and the local timer fires first wins.
    socket.on(EVENTS.raceStart, (p: RaceStartPayload) => triggerGo(p.startsAt));

    // Everyone is back after a disconnect: the server moved the race clock forward by the paused time.
    socket.on(EVENTS.raceResumed, (p: RaceResumedPayload) => {
      setRace((r) => (r ? { ...r, startsAt: p.startsAt } : r));
      setGo((g) => (g ? { perfStart: performance.now() - (serverNow() - p.startsAt) } : g));
    });

    socket.on(EVENTS.raceProgress, (p: OpponentProgress) => setOpponent(p));
    socket.on(EVENTS.raceTimeUp, () => setTimeUp(true));
    socket.on(EVENTS.raceResult, (r: MatchResult) => {
      clearGoTimer();
      setResult(r);
      setSaveStatus("pending"); // the server saves in the background and tells us how it went
    });
    socket.on(EVENTS.matchSaved, () => setSaveStatus("saved"));
    socket.on(EVENTS.matchSaveFailed, () => setSaveStatus("failed"));
    // player:presence is not needed here: connectivity is mirrored in room.players[].connected.

    socket.connect();

    return () => {
      goneRef.current = true;
      clearGoTimer();
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [serverNow]);

  const request = useCallback(<T,>(event: string, payload: unknown = {}): Promise<Ack<T>> => {
    return new Promise((resolve) => {
      const s = socketRef.current;
      if (!s || !s.connected) {
        resolve(failAck("Not connected to the server"));
        return;
      }
      s.timeout(5000).emit(event, payload, (err: Error | null, res: Ack<T>) =>
        resolve(err ? failAck("The server did not respond") : res),
      );
    });
  }, []);

  /** Auth is fixed at handshake time, so a name change means reconnecting (never while seated). */
  const ensureName = useCallback(async (name: string): Promise<boolean> => {
    const s = socketRef.current;
    const id = identityRef.current;
    if (!s || !id) return false;
    if (id.name === name && s.connected) return true;
    id.name = name;
    saveName(name);
    s.auth = { playerId: id.playerId, name };
    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => resolve(false), 5000);
      s.once("connect", () => {
        clearTimeout(timeout);
        resolve(true);
      });
      s.disconnect().connect();
    });
  }, []);

  const create = useCallback(
    async (name: string): Promise<Ack<unknown>> => {
      if (!(await ensureName(name))) return failAck("Can't reach the game server");
      const res = await request<{ room: RoomSnapshot }>(EVENTS.roomCreate);
      if (res.ok) setRoom(res.data.room);
      return res;
    },
    [ensureName, request],
  );

  const join = useCallback(
    async (name: string, code: string): Promise<Ack<unknown>> => {
      if (!(await ensureName(name))) return failAck("Can't reach the game server");
      const res = await request<{ room: RoomSnapshot }>(EVENTS.roomJoin, { code });
      if (res.ok) setRoom(res.data.room);
      return res;
    },
    [ensureName, request],
  );

  /** Host only: change the race length between races. */
  const configure = useCallback((durationSec: number) => request(EVENTS.roomConfig, { durationSec }), [request]);

  const setReady = useCallback((ready: boolean) => request(EVENTS.roomReady, { ready }), [request]);

  const leave = useCallback(async () => {
    const res = await request(EVENTS.roomLeave);
    if (res.ok) {
      if (goTimer.current) clearTimeout(goTimer.current);
      setRoom(null);
      setRace(null);
      setGo(null);
      setOpponent(null);
      setResult(null);
    }
    return res;
  }, [request]);

  /** Fire-and-forget; volatile so reports queued while offline are dropped, not replayed late. */
  const sendProgress = useCallback((p: Omit<RaceProgress, "seq">) => {
    const s = socketRef.current;
    if (!s?.connected) return;
    s.volatile.emit(EVENTS.raceProgress, { seq: ++seqRef.current, ...p });
  }, []);

  const sendFinish = useCallback(
    (payload: RaceFinishPayload) => request(EVENTS.raceFinish, payload),
    [request],
  );

  return {
    identity,
    conn,
    connError,
    room,
    race,
    go,
    opponent,
    result,
    saveStatus,
    paused: room?.paused ?? null,
    serverNow,
    create,
    join,
    setReady,
    configure,
    timeUp,
    leave,
    sendProgress,
    sendFinish,
  };
}

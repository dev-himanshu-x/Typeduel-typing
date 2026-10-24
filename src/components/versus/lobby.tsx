"use client";

import { useState, type FormEvent } from "react";
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, type Ack, type RoomSnapshot } from "@shared/protocol";

interface LobbyProps {
  /** Seat of the local player; null = not in a room yet. */
  room: RoomSnapshot | null;
  meId: string | null;
  initialName: string;
  initialCode?: string;
  disabled: boolean; // no usable connection
  onCreate: (name: string) => Promise<Ack<unknown>>;
  onJoin: (name: string, code: string) => Promise<Ack<unknown>>;
  onReady: (ready: boolean) => Promise<Ack<unknown>>;
  onLeave: () => Promise<Ack<unknown>>;
}

const sanitizeCode = (v: string) =>
  v
    .toUpperCase()
    .split("")
    .filter((c) => ROOM_CODE_ALPHABET.includes(c))
    .join("")
    .slice(0, ROOM_CODE_LENGTH);

export function Lobby(props: LobbyProps) {
  return props.room ? <RoomPanel {...props} room={props.room} /> : <EntryPanel {...props} />;
}

function EntryPanel({ initialName, initialCode = "", disabled, onCreate, onJoin }: LobbyProps) {
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState(sanitizeCode(initialCode));
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();
  const nameOk = trimmed.length >= 1 && trimmed.length <= 16;

  async function run(kind: "create" | "join", action: () => Promise<Ack<unknown>>) {
    setBusy(kind);
    setError(null);
    const res = await action();
    setBusy(null);
    if (!res.ok) setError(res.error.message);
  }

  const submitJoin = (e: FormEvent) => {
    e.preventDefault();
    if (code.length !== ROOM_CODE_LENGTH) {
      setError(`Room codes are ${ROOM_CODE_LENGTH} characters`);
      return;
    }
    void run("join", () => onJoin(trimmed, code));
  };

  return (
    <section className="panel mx-auto grid w-full max-w-md gap-6" aria-labelledby="versus-title">
      <header className="grid gap-1">
        <h1 id="versus-title" className="text-xl text-text">
          1v1 versus
        </h1>
        <p className="text-sm text-text-muted">Race a friend on the exact same text.</p>
      </header>

      <label className="grid gap-1.5 text-sm text-text-muted">
        Your name
        <input
          className="input"
          name="name"
          data-testid="name-input"
          value={name}
          maxLength={16}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      <button
        type="button"
        className="btn btn-primary"
        data-testid="create-room"
        disabled={disabled || !nameOk || busy !== null}
        onClick={() => run("create", () => onCreate(trimmed))}
      >
        {busy === "create" ? "Creating…" : "Create Room"}
      </button>

      <div className="flex items-center gap-3 text-xs text-text-muted" aria-hidden>
        <span className="h-px flex-1 bg-border" />
        or join with a code
        <span className="h-px flex-1 bg-border" />
      </div>

      <form className="grid gap-3 sm:grid-cols-[1fr_auto]" onSubmit={submitJoin}>
        <input
          className="input text-center tracking-[0.3em] uppercase"
          name="code"
          data-testid="code-input"
          aria-label="Room code"
          placeholder="ABC234"
          value={code}
          maxLength={ROOM_CODE_LENGTH}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          onChange={(e) => setCode(sanitizeCode(e.target.value))}
        />
        <button
          type="submit"
          className="btn btn-secondary"
          data-testid="join-room"
          disabled={disabled || !nameOk || busy !== null}
        >
          {busy === "join" ? "Joining…" : "Join Room"}
        </button>
      </form>

      <p role="alert" className="min-h-5 text-sm text-incorrect" data-testid="lobby-error">
        {error}
      </p>
    </section>
  );
}

function RoomPanel({ room, meId, disabled, onReady, onLeave }: LobbyProps & { room: RoomSnapshot }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const me = room.players.find((p) => p.id === meId);
  const opponent = room.players.find((p) => p.id !== meId);

  async function copyLink() {
    const url = `${window.location.origin}/versus/${room.code}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Couldn't copy: share the code instead");
    }
  }

  async function toggleReady() {
    setError(null);
    const res = await onReady(!me?.ready);
    if (!res.ok) setError(res.error.message);
  }

  return (
    <section className="panel mx-auto grid w-full max-w-md gap-6" aria-labelledby="room-title">
      <header className="grid gap-2 text-center">
        <h1 id="room-title" className="text-sm text-text-muted">
          Room code
        </h1>
        <p className="font-[family-name:var(--font-mono)] text-4xl tracking-[0.25em] text-cursor" data-testid="room-code">
          {room.code}
        </p>
        <button type="button" className="btn btn-ghost btn-sm mx-auto" onClick={copyLink}>
          {copied ? "link copied" : "copy invite link"}
        </button>
      </header>

      <ul className="grid gap-2" aria-label="Players">
        <PlayerRow name={me?.name ?? "you"} you ready={!!me?.ready} connected={me?.connected ?? true} />
        {opponent ? (
          <PlayerRow name={opponent.name} ready={opponent.ready} connected={opponent.connected} />
        ) : (
          <li className="rounded border border-dashed border-border bg-bg px-3 py-2 text-sm text-text-muted">
            Waiting for an opponent to join…
          </li>
        )}
      </ul>

      <div className="grid gap-3">
        <button
          type="button"
          className={`btn ${me?.ready ? "btn-secondary" : "btn-primary"}`}
          data-testid="ready"
          aria-pressed={!!me?.ready}
          disabled={disabled || !opponent}
          onClick={toggleReady}
        >
          {me?.ready ? "Ready ✓ (click to cancel)" : "Ready"}
        </button>
        {!opponent && <p className="text-center text-xs text-text-muted">Ready unlocks when both players are here.</p>}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          data-testid="leave"
          onClick={async () => {
            const res = await onLeave();
            if (!res.ok) setError(res.error.message);
          }}
        >
          Leave room
        </button>
      </div>

      <p role="alert" className="min-h-5 text-sm text-incorrect">
        {error}
      </p>
    </section>
  );
}

function PlayerRow({ name, you, ready, connected }: { name: string; you?: boolean; ready: boolean; connected: boolean }) {
  const status = !connected ? "offline" : ready ? "ready" : "not ready";
  const tone = !connected ? "text-incorrect" : ready ? "text-cursor" : "text-text-muted";
  return (
    <li className="flex items-center justify-between gap-3 rounded border border-border bg-bg px-3 py-2">
      <span className="min-w-0 truncate">
        {name}
        {you && <span className="ml-2 text-xs text-text-muted">you</span>}
      </span>
      <span className={`shrink-0 text-sm ${tone}`}>{status}</span>
    </li>
  );
}

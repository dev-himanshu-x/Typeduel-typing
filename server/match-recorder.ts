import type { MatchResultPlayer } from "../shared/protocol";

/** Everything needed to persist one finished match. Plain data: no sockets, no DB types. */
export interface MatchRecord {
  matchId: string;
  roomCode: string;
  wordCount: number;
  seed: number;
  bankVersion: number;
  reason: "finished" | "forfeit";
  durationMs: number | null;
  winnerId: string | null;
  /** player1 = first to join the room, player2 = second. */
  players: [RecordedPlayer, RecordedPlayer];
}

export interface RecordedPlayer {
  id: string;
  name: string;
  result: MatchResultPlayer;
}

/** Persistence backend. Must be idempotent per `matchId` (retries re-run `save`). */
export interface MatchStore {
  save(record: MatchRecord): Promise<void>;
  close?(): Promise<void>;
}

export interface RecorderOptions {
  /** Max simultaneous store writes. */
  concurrency: number;
  /** Queue cap; beyond it records are dropped (and logged) rather than growing without bound. */
  maxQueue: number;
  /** Delay before each retry; its length is the number of retries. */
  retryDelaysMs: number[];
  /** Hard cap on a single save attempt. */
  attemptTimeoutMs: number;
}

export const DEFAULT_RECORDER_OPTIONS: RecorderOptions = {
  concurrency: 4,
  maxQueue: 500,
  retryDelaysMs: [500, 2_000, 8_000],
  attemptTimeoutMs: 10_000,
};

export interface RecorderHooks {
  onSaved?(record: MatchRecord): void;
  onFailed?(record: MatchRecord, error: unknown): void;
}

/**
 * Background writer for finished matches. `enqueue` is synchronous and never throws, so the
 * game loop can fire it and move on: results reach players before (and regardless of) the write.
 */
export class MatchRecorder {
  private queue: MatchRecord[] = [];
  private active = 0;
  private idleWaiters: (() => void)[] = [];

  constructor(
    private readonly store: MatchStore,
    private readonly opts: RecorderOptions = DEFAULT_RECORDER_OPTIONS,
    private readonly hooks: RecorderHooks = {},
  ) {}

  /** Records waiting or being written. */
  get pending(): number {
    return this.queue.length + this.active;
  }

  enqueue(record: MatchRecord): void {
    if (this.queue.length >= this.opts.maxQueue) {
      console.error("[recorder] queue full, dropping match", JSON.stringify(record));
      this.fail(record, new Error("queue full"));
      return;
    }
    this.queue.push(record);
    this.pump();
  }

  /** Wait (bounded) for in-flight and queued writes, e.g. on shutdown. */
  async drain(timeoutMs: number): Promise<void> {
    if (this.pending === 0) return;
    await Promise.race([
      new Promise<void>((resolve) => this.idleWaiters.push(resolve)),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs).unref()),
    ]);
  }

  async close(timeoutMs = 5_000): Promise<void> {
    await this.drain(timeoutMs);
    await this.store.close?.();
  }

  private pump(): void {
    while (this.active < this.opts.concurrency && this.queue.length > 0) {
      const record = this.queue.shift()!;
      this.active++;
      void this.run(record).finally(() => {
        this.active--;
        this.pump();
        if (this.pending === 0) for (const w of this.idleWaiters.splice(0)) w();
      });
    }
  }

  private async run(record: MatchRecord): Promise<void> {
    const attempts = this.opts.retryDelaysMs.length + 1;
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) await sleep(this.opts.retryDelaysMs[attempt - 1]);
      try {
        await withTimeout(this.store.save(record), this.opts.attemptTimeoutMs);
        try {
          this.hooks.onSaved?.(record);
        } catch (err) {
          console.error("[recorder] onSaved hook threw:", err);
        }
        return;
      } catch (err) {
        lastError = err;
        console.error(
          `[recorder] save failed for match ${record.matchId} (attempt ${attempt + 1}/${attempts}):`,
          err instanceof Error ? err.message : err,
        );
      }
    }
    // Out of retries: keep the full payload in the log so it can be replayed by hand.
    console.error("[recorder] giving up; unsaved match payload:", JSON.stringify(record));
    this.fail(record, lastError);
  }

  private fail(record: MatchRecord, error: unknown): void {
    try {
      this.hooks.onFailed?.(record, error);
    } catch (err) {
      console.error("[recorder] onFailed hook threw:", err);
    }
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref());

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`save timed out after ${ms}ms`)), ms);
    timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

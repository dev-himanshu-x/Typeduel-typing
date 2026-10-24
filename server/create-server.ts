import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Server } from "socket.io";
import { registerHandlers } from "./handlers";
import { DEFAULT_MACHINE_OPTIONS, RoomMachine, type MachineOptions } from "./room-machine";
import { RoomStore } from "./room-store";
import { DEFAULT_RECORDER_OPTIONS, MatchRecorder, type MatchStore, type RecorderOptions } from "./match-recorder";
import { EVENTS, type MatchSavePayload } from "../shared/protocol";

export interface ServerConfig extends Partial<MachineOptions> {
  /** 0 picks a free port (used by tests). */
  port: number;
  clientOrigins: string[];
  /** When set, finished matches are persisted through it (in the background). */
  matchStore?: MatchStore;
  recorder?: Partial<RecorderOptions>;
}

export function createGameServer(config: ServerConfig) {
  const store = new RoomStore();
  const httpServer = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, rooms: store.size }));
      return;
    }
    res.writeHead(404).end();
  });

  const io = new Server(httpServer, {
    cors: { origin: config.clientOrigins },
    // Browsers always send Origin: reject foreign sites. Non-browser clients send none.
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      callback(null, origin === undefined || config.clientOrigins.includes(origin));
    },
  });

  const recorder = config.matchStore
    ? new MatchRecorder(
        config.matchStore,
        { ...DEFAULT_RECORDER_OPTIONS, ...config.recorder },
        {
          onSaved: (r) => io.to(r.roomCode).emit(EVENTS.matchSaved, { matchId: r.matchId } satisfies MatchSavePayload),
          onFailed: (r) =>
            io.to(r.roomCode).emit(EVENTS.matchSaveFailed, { matchId: r.matchId } satisfies MatchSavePayload),
        },
      )
    : undefined;

  const machine = new RoomMachine(
    io,
    store,
    {
    countdownMs: config.countdownMs ?? DEFAULT_MACHINE_OPTIONS.countdownMs,
    graceLobbyMs: config.graceLobbyMs ?? DEFAULT_MACHINE_OPTIONS.graceLobbyMs,
    graceRaceMs: config.graceRaceMs ?? DEFAULT_MACHINE_OPTIONS.graceRaceMs,
    maxWpm: config.maxWpm ?? DEFAULT_MACHINE_OPTIONS.maxWpm,
    allowedDurations: config.allowedDurations ?? DEFAULT_MACHINE_OPTIONS.allowedDurations,
    defaultDurationSec: config.defaultDurationSec ?? DEFAULT_MACHINE_OPTIONS.defaultDurationSec,
    submitWaitMs: config.submitWaitMs ?? DEFAULT_MACHINE_OPTIONS.submitWaitMs,
    submitEarlyToleranceMs: config.submitEarlyToleranceMs ?? DEFAULT_MACHINE_OPTIONS.submitEarlyToleranceMs,
    },
    recorder,
  );
  registerHandlers(io, machine);

  return {
    io,
    store,
    machine,
    recorder,
    listen: () =>
      new Promise<number>((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(config.port, () => resolve((httpServer.address() as AddressInfo).port));
      }),
    close: async () => {
      machine.dispose();
      await io.close(); // also closes the underlying http server
      await recorder?.close(); // let in-flight match writes finish (bounded), then release the store
    },
  };
}

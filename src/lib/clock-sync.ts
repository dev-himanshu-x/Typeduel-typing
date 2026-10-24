import type { Socket } from "socket.io-client";
import { EVENTS, type Ack } from "@shared/protocol";

interface SyncReply {
  clientSentMs: number;
  serverNowMs: number;
}

/**
 * Estimates `serverNow - Date.now()` (NTP-style). Takes several samples and keeps the one
 * with the lowest round-trip time, which has the smallest asymmetry error.
 */
export async function measureClockOffset(socket: Socket, samples = 5): Promise<number | null> {
  let best: { rtt: number; offset: number } | null = null;
  for (let i = 0; i < samples; i++) {
    const t0 = Date.now();
    const res = await new Promise<Ack<SyncReply> | null>((resolve) => {
      socket.timeout(2000).emit(EVENTS.timeSync, { clientSentMs: t0 }, (err: Error | null, ack: Ack<SyncReply>) =>
        resolve(err ? null : ack),
      );
    });
    const t1 = Date.now();
    if (!res || !res.ok) continue;
    const rtt = t1 - t0;
    const offset = res.data.serverNowMs + rtt / 2 - t1;
    if (!best || rtt < best.rtt) best = { rtt, offset };
  }
  return best ? best.offset : null;
}

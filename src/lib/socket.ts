import { io, type Socket } from "socket.io-client";
import type { Identity } from "@shared/protocol";

export const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:4000";

const ID_KEY = "typing:playerId";
const NAME_KEY = "typing:name";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null; // private mode / blocked storage
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore: identity just won't survive a reload */
  }
}

/** Stable guest identity: the playerId lets a reload reclaim its seat on the server. */
export function loadIdentity(): Identity {
  let playerId = read(ID_KEY);
  if (!playerId) {
    playerId = crypto.randomUUID();
    write(ID_KEY, playerId);
  }
  let name = read(NAME_KEY);
  if (!name) {
    name = `guest-${Math.floor(1000 + Math.random() * 9000)}`;
    write(NAME_KEY, name);
  }
  return { playerId, name };
}

export function saveName(name: string) {
  write(NAME_KEY, name);
}

/** Not connected yet: the caller attaches listeners, then calls `connect()`. */
export function createSocket(identity: Identity): Socket {
  return io(SOCKET_URL, {
    auth: { playerId: identity.playerId, name: identity.name },
    autoConnect: false,
    reconnectionDelay: 500,
    reconnectionDelayMax: 3000,
  });
}

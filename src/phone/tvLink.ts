// The TV's connection to the local relay. Development only, because the relay runs on the
// computer that's serving the game.

import type { PhoneLink } from "./phoneLink";
import { parsePhoneState } from "./protocol";

const ROOM_KEY = "ragebait.phoneRoom";
const RECONNECT_MS = 2000;

/** Keeps its code across reloads, so a saved edit doesn't leave a paired phone stranded. */
function roomCode(): string {
  try {
    const saved = sessionStorage.getItem(ROOM_KEY);
    if (saved) return saved;
  } catch {
    // Storage can be refused. It only means scanning again after a reload.
  }
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const code = Array.from(bytes, (b) => (b % 36).toString(36)).join("");
  try {
    sessionStorage.setItem(ROOM_KEY, code);
  } catch {
    // As above.
  }
  return code;
}

/** Joins the relay, and gives back the link for the QR code. Null if there's no relay here. */
export async function startPhoneLink(link: PhoneLink): Promise<string | null> {
  let info: { url?: unknown };
  try {
    const response = await fetch("/phone-relay/info");
    if (!response.ok) return null;
    info = (await response.json()) as { url?: unknown };
  } catch {
    return null;
  }
  if (typeof info.url !== "string") return null;
  const room = roomCode();

  const connect = (): void => {
    const socket = new WebSocket(`ws://${location.host}/phone-relay/tv?room=${room}`);
    socket.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      const state = parsePhoneState(event.data);
      if (state) link.receive(state);
    };
    socket.onclose = () => window.setTimeout(connect, RECONNECT_MS);
  };
  connect();
  return `${info.url}?room=${room}`;
}

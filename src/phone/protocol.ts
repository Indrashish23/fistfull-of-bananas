// What a phone tells the TV. It's only ever how loud someone is, never what they said.

import { clamp } from "../game/rules";

export type PhoneState = {
  /** 0..1, how hard someone's shouting. */
  level: number;
  /** The raw reading, for tuning. */
  db: number;
  mic: boolean;
  /** How long the last message took to reach the computer and come back. */
  rttMs: number | null;
};

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Reads a message off the network. Anything malformed comes back as null. */
export function parsePhoneState(raw: string): PhoneState | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const m = data as Record<string, unknown>;
  if (!finite(m.level) || !finite(m.db)) return null;
  return {
    level: clamp(m.level, 0, 1),
    db: m.db,
    mic: m.mic === true,
    rttMs: finite(m.rttMs) ? m.rttMs : null,
  };
}

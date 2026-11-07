// Turning a microphone's samples into how hard someone is shouting. No browser audio here,
// so all of it runs in plain tests.

/** The quietest room we'll believe, so a dead-silent mic doesn't make a cough count as a shout. */
const ROOM_FLOOR_DB = -65;
/** The room's level falls quickly when it goes quiet. */
const ROOM_FALL_PER_SEC = 6;
/** It climbs slowly, in dB per second, so a long shout isn't mistaken for a loud room. */
const ROOM_RISE_DB_PER_SEC = 1;
/** This far above the room is where a voice starts to count. */
const ABOVE_ROOM_DB = 6;
/**
 * And this much further is a full shout. Tuned on an iPhone in a quiet room, which idles around
 * -65 dB and flickers up to -60, and where a raised voice near the phone reads -40 to -50 dB.
 */
const SHOUT_RANGE_DB = 10;

export function rmsToDb(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  const rms = samples.length > 0 ? Math.sqrt(sum / samples.length) : 0;
  return 20 * Math.log10(Math.max(rms, 0.00001));
}

/** Tracks the room's steady level: its fans, its chatter, the game's own music. */
export function followRoom(room: number, db: number, dt: number): number {
  const next = db < room
    ? room + (db - room) * Math.min(1, ROOM_FALL_PER_SEC * dt)
    : room + Math.min(db - room, ROOM_RISE_DB_PER_SEC * dt);
  return Math.max(ROOM_FLOOR_DB, next);
}

/** 0 is the room's own noise, and 1 is a full shout. */
export function loudnessFrom(db: number, room: number): number {
  return Math.min(1, Math.max(0, (db - room - ABOVE_ROOM_DB) / SHOUT_RANGE_DB));
}

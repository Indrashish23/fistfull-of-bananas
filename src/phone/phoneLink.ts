// The TV's view of the phone: its latest reading, dropped if it goes quiet.

import type { PhoneState } from "./protocol";

/** No message for this long means the phone's gone, so a shout can't get stuck on. */
export const PHONE_STALE_SEC = 0.6;

export class PhoneLink {
  /** How long the last message took to reach the computer and come back. */
  rttMs: number | null = null;
  db = -100;
  private state: PhoneState | null = null;
  private age = Infinity;

  get live(): boolean {
    return this.state !== null && this.age < PHONE_STALE_SEC;
  }

  get level(): number {
    return this.live ? this.state!.level : 0;
  }

  get mic(): boolean {
    return this.live && this.state!.mic;
  }

  receive(state: PhoneState): void {
    this.state = state;
    this.age = 0;
    this.rttMs = state.rttMs;
    this.db = state.db;
  }

  update(dt: number): void {
    this.age += dt;
  }
}

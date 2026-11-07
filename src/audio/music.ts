// The music: a real recording, looped (see CREDITS.md beside it). It streams from an audio element rather
// than being decoded whole, so two minutes of stereo doesn't sit in memory on the TV, and runs through a gain
// so it can duck under the big moments.

import TRACK from "./music/spaghetti_western.ogg?url";

/** How loud the music sits under the game. */
const LEVEL = 0.55;

export class Music {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private element: HTMLAudioElement | null = null;
  private on = true;

  /** Browsers only allow sound after a gesture, so this runs on the first press. Safe to call again. */
  start(): void {
    if (!this.element) {
      const Ctor = window.AudioContext;
      if (!Ctor) return;
      const element = new window.Audio(TRACK);
      element.loop = true;
      element.preload = "auto";
      const ctx = new Ctor();
      const gain = ctx.createGain();
      gain.gain.value = this.on ? LEVEL : 0;
      ctx.createMediaElementSource(element).connect(gain).connect(ctx.destination);
      this.ctx = ctx;
      this.gain = gain;
      this.element = element;
    }
    void this.ctx?.resume();
    if (this.on && this.element.paused) void this.element.play().catch(() => {});
  }

  /** Stops it while the app's in the background, and picks up where it was after. */
  setMusic(on: boolean): void {
    this.on = on;
    if (!this.element || !this.ctx || !this.gain) return;
    this.gain.gain.setTargetAtTime(on ? LEVEL : 0, this.ctx.currentTime, 0.08);
    if (on) {
      void this.ctx.resume();
      void this.element.play().catch(() => {});
    } else {
      this.element.pause();
    }
  }

  /** Drops the music to a share of its level for a while, then brings it back. */
  duck(amount: number, seconds: number): void {
    if (!this.ctx || !this.gain || !this.on) return;
    const t = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setTargetAtTime(LEVEL * amount, t, 0.02);
    this.gain.gain.setTargetAtTime(LEVEL, t + seconds, 0.4);
  }
}

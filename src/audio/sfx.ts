// Every sound effect is a real recording, cut down in src/audio/clips (see CREDITS.md there). Each play
// picks a take and nudges its pitch, so a hundred shots in a row don't sound like one shot on repeat.

const FILES = import.meta.glob("./clips/*.ogg", { eager: true, query: "?url", import: "default" }) as Record<string, string>;

/** Which takes each sound can use. */
const TAKES = {
  shot: ["shot1", "shot2", "shot3"],
  shotHeavy: ["shot_heavy"],
  cylOpen: ["cyl_open"],
  cylClose: ["cyl_close"],
  eject: ["shells_eject"],
  shell: ["shell1", "shell2"],
  bullet: ["bullet_in"],
  turn: ["turn1", "turn2", "turn3"],
  dry: ["dry_fire"],
  cock: ["cock1", "cock2"],
  rico: ["rico1", "rico2"],
  bodyHit: ["body_hit"],
  punch: ["punch"],
  thudBig: ["thud_big"],
  thudSmall: ["thud_small"],
  grunt: ["grunt"],
  woodHit: ["wood_hit1", "wood_hit2", "wood_hit3"],
  woodBreak: ["wood_break1", "wood_break2"],
  land: ["barrel_land"],
  glass: ["glass1", "glass2"],
  fireBurst: ["fire_burst"],
  ignite: ["ignite"],
  boom: ["boom"],
  whoosh: ["whoosh1", "whoosh2"],
  scream: ["scream1", "scream2", "scream3"],
  squawk: ["squawk"],
  bell: ["bell1", "bell2"],
  gong: ["gong"],
  ui: ["ui_click"],
  win: ["win_banjo"],
} as const;

type Sound = keyof typeof TAKES;

interface PlayOptions {
  gain?: number;
  /** Playback speed, which also sets the pitch. */
  rate?: number;
  /** How much the pitch varies either way, as a share. */
  vary?: number;
  delay?: number;
}

/** How loud the fire's crackle gets at its biggest. */
const FIRE_LOOP_GAIN = 0.55;

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private fireGain: GainNode | null = null;
  private fireLevel = 0;

  /** Browsers only allow audio after a gesture, so this runs on the first press. */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    // A limiter on the end, since a kill can stack a shot, a thud and a scream all at once.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    this.master.connect(limiter).connect(ctx.destination);
    void this.loadAll(ctx);
  }

  private async loadAll(ctx: AudioContext): Promise<void> {
    await Promise.all(Object.entries(FILES).map(async ([path, url]) => {
      const name = path.replace(/^.*\/|\.ogg$/g, "");
      try {
        const data = await (await fetch(url)).arrayBuffer();
        this.buffers.set(name, await ctx.decodeAudioData(data));
      } catch (error) {
        console.warn(`Couldn't load the sound ${name}`, error);
      }
    }));
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    void this.ctx?.resume();
  }

  private play(sound: Sound, options: PlayOptions = {}): void {
    const { ctx, master } = this;
    if (!ctx || !master) return;
    const takes = TAKES[sound];
    const buffer = this.buffers.get(takes[Math.floor(Math.random() * takes.length)]!);
    if (!buffer) return;
    const vary = options.vary ?? 0.04;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = (options.rate ?? 1) * (1 + (Math.random() * 2 - 1) * vary);
    const gain = ctx.createGain();
    gain.gain.value = options.gain ?? 1;
    src.connect(gain).connect(master);
    src.start(ctx.currentTime + (options.delay ?? 0));
  }

  /** A plain shot: the bang, then what it hit. */
  shot(hit: boolean, hitBody: boolean): void {
    this.play("shot", { gain: 0.9, vary: 0.06 });
    if (hitBody) this.play("bodyHit", { gain: 0.7, delay: 0.03 });
    else if (!hit && Math.random() < 0.4) this.play("rico", { gain: 0.35, delay: 0.08, vary: 0.1 });
  }

  /** A bullet coming out the back, with a whine as it carries on. */
  pierce(hitAnother: boolean): void {
    this.play("rico", { gain: 0.5, delay: 0.04, rate: 1.2, vary: 0.1 });
    if (hitAnother) this.play("bodyHit", { gain: 0.8, delay: 0.09 });
  }

  /** The big black powder shot, slowed down for the bullet cam. */
  gunshot(slowSec: number): void {
    this.play("shotHeavy", { rate: slowSec > 0.5 ? 0.7 : 1, gain: 1, vary: 0 });
  }

  /** The hammer falling on nothing. */
  dryFire(): void {
    this.play("dry", { gain: 0.8 });
  }

  /** The cylinder swinging out, and the empties sliding from it. */
  cylinderOpen(): void {
    this.play("cylOpen", { gain: 0.95 });
  }

  shellsFall(count: number): void {
    if (count <= 0) return;
    this.play("eject", { gain: 0.7, delay: 0.08 });
    // And a few of them hitting the dirt a moment later.
    for (let i = 0; i < Math.min(count, 3); i++) {
      this.play("shell", { gain: 0.45, delay: 0.32 + i * 0.09 + Math.random() * 0.05, vary: 0.12 });
    }
  }

  /** One round going home, then the cylinder clicking round. It climbs a little as it fills. */
  bulletIn(loaded: number): void {
    this.play("bullet", { gain: 0.95, rate: 1 + loaded * 0.025, vary: 0.02 });
    this.play("turn", { gain: 0.55, delay: 0.07, rate: 1 + loaded * 0.02 });
  }

  /** The cylinder snapping shut, then cocked and ready. */
  cylinderClose(): void {
    this.play("cylClose", { gain: 1 });
    this.play("cock", { gain: 0.7, delay: 0.16 });
  }

  woodHit(big: boolean): void {
    if (big) {
      this.play("woodBreak", { gain: 1 });
      this.play("thudSmall", { gain: 0.6 });
    } else {
      this.play("woodHit", { gain: 0.9, vary: 0.08 });
    }
  }

  /** A worried noise, from a goon getting right down. */
  duckSquawk(): void {
    this.play("squawk", { gain: 0.5, rate: 1.35 });
  }

  /** Someone on fire, panicking. Each one's a little different. */
  scream(): void {
    this.play("scream", { gain: 0.65, rate: 1.15, vary: 0.14 });
  }

  /** A thump for something big happening. */
  stab(big: boolean): void {
    this.play(big ? "thudBig" : "thudSmall", { gain: big ? 0.85 : 0.6 });
  }

  /** The bell over a saloon door, for a new wave or a combo. */
  bell(): void {
    this.play("bell", { gain: 0.55 });
  }

  gong(): void {
    this.play("gong", { gain: 0.6 });
  }

  click(): void {
    this.play("ui", { gain: 0.35, vary: 0.05 });
  }

  /** Points landing. A cylinder click, so it stays in the world of the gun. */
  tick(): void {
    this.play("turn", { gain: 0.3, rate: 1.3, vary: 0.05 });
  }

  pass(): void {
    this.bell();
  }

  boom(): void {
    this.play("boom", { gain: 1, vary: 0.05 });
  }

  /** Flames bursting out across the ground, where a fire bottle came down. */
  fireBurst(): void {
    this.play("fireBurst", { gain: 0.75, vary: 0.06 });
  }

  /** Someone going up in flames. */
  ignite(): void {
    this.play("ignite", { gain: 0.8, vary: 0.08 });
  }

  /**
   * The crackle of whatever's burning, looped underneath everything: 0 is silent, 1 is a street on fire.
   * Call it every frame. It eases to the new level, so it never clicks on or off.
   */
  fireLoop(level: number): void {
    const { ctx, master } = this;
    if (!ctx || !master) return;
    if (!this.fireGain) {
      const buffer = this.buffers.get("fire_loop");
      if (!buffer) return;
      this.fireGain = ctx.createGain();
      this.fireGain.gain.value = 0;
      this.fireGain.connect(master);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      src.connect(this.fireGain);
      src.start();
    }
    const target = Math.min(1, Math.max(0, level)) * FIRE_LOOP_GAIN;
    if (Math.abs(target - this.fireLevel) < 0.005) return;
    this.fireLevel = target;
    this.fireGain.gain.setTargetAtTime(target, ctx.currentTime, 0.25);
  }

  glass(): void {
    this.play("glass", { gain: 0.65, vary: 0.08 });
  }

  /** A barrel coming down in the street. */
  barrelLand(): void {
    this.play("land", { gain: 0.85, vary: 0.08 });
    this.play("thudSmall", { gain: 0.35 });
  }

  /** You've been hit. */
  hurt(): void {
    this.play("punch", { gain: 0.9 });
    this.play("grunt", { gain: 0.8, delay: 0.03, vary: 0.05 });
  }

  /** A body hit in the kill cam: the crack at contact, and the body landing at the drop. */
  hit(_shooter: number, _bar: number, zone: "head" | "nuts" | "body", contact = 0, drop = 0): void {
    this.play("bodyHit", { gain: 0.9, delay: contact });
    if (zone === "head") {
      this.play("woodBreak", { gain: 0.5, rate: 1.5, delay: contact });
      this.play("bell", { gain: 0.5, delay: contact, vary: 0 });
    } else if (zone === "nuts") {
      this.play("squawk", { gain: 0.7, rate: 1.7, delay: contact + 0.05, vary: 0 });
    }
    this.play("thudSmall", { gain: 0.6, delay: drop });
  }

  /** Something flying past. */
  miss(): void {
    this.play("whoosh", { gain: 0.65, vary: 0.1 });
  }

  fanfare(): void {
    this.play("win", { gain: 1, vary: 0 });
  }

  /** The gun's barrels spinning up: a ratchet that gets faster and higher as it goes. */
  spinUp(sec: number): void {
    const n = 16;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      this.play("turn", { gain: 0.25 + u * 0.4, rate: 0.8 + u * 0.7, delay: sec * Math.sqrt(u), vary: 0.02 });
    }
  }

  /** The minigun itself: real shots, very close together. */
  minigun(sec: number): void {
    const gap = 0.055;
    const n = Math.floor(sec / gap);
    for (let i = 0; i < n; i++) this.play("shot", { gain: 0.42, rate: 1.35, delay: i * gap, vary: 0.09 });
  }

  /** A shot glancing off him. */
  ping(): void {
    this.play("rico", { gain: 0.6, rate: 1.5, vary: 0.12 });
  }

  /** A pitched-down bellow. */
  roar(): void {
    this.play("scream", { gain: 0.95, rate: 0.5, vary: 0.05 });
    this.play("thudSmall", { gain: 0.3 });
  }

  /** A shot right in the heart, with a bell on it. */
  heartHit(): void {
    this.play("bodyHit", { gain: 1, vary: 0.05 });
    this.play("bell", { gain: 0.35, rate: 0.8, vary: 0 });
  }

  /** A shot to the body, which he hardly notices. */
  bodyThud(): void {
    this.play("bodyHit", { gain: 0.4, rate: 1.2, vary: 0.1 });
  }

  /** A footfall on the ride up the street. */
  footstep(): void {
    this.play("thudSmall", { gain: 0.15, rate: 1.5, vary: 0.1 });
  }

  /** The barricades coming down, one after another. */
  barricades(count: number, gap: number): void {
    for (let i = 0; i < count; i++) this.play("land", { gain: 0.7, delay: 0.5 + i * gap, vary: 0.1 });
  }

  /** The boss hitting the street. */
  bossLand(): void {
    this.play("boom", { gain: 0.75, rate: 0.8, vary: 0 });
    this.play("thudBig", { gain: 1, vary: 0 });
  }

  /** A wave's tally ticking up, then the grade slamming down on it. */
  tally(gradeAt: number): void {
    for (let i = 0; i < 4; i++) this.play("turn", { gain: 0.5, delay: 0.3 + i * 0.2, rate: 1 + i * 0.08, vary: 0 });
    this.play("thudBig", { gain: 0.8, delay: gradeAt });
    this.play("bell", { gain: 0.5, delay: gradeAt });
  }

  /** A word telling you which way to dodge: the hammer going back. */
  cock(): void {
    this.play("cock", { gain: 0.8 });
  }
}

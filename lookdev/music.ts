// An original spaghetti-western cue and the gunshot, synthesised live with Web Audio. There are
// no audio files. The melody and arrangement are written for this game: the style borrows the
// genre's instruments (whistle, twangy guitar, hoofbeats, whip, muted trumpet, choir) and none
// of any film's tunes.

const midi = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

const N: Record<string, number> = {};
["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"].forEach((name, i) => {
  for (let oct = 1; oct <= 6; oct++) N[`${name}${oct}`] = 12 * (oct + 1) + i;
});

const BPM = 96;
const BEAT = 60 / BPM;

/** [note, beats]. null is a rest. Each bar is 4 beats. */
type Line = [string | null, number][];

const WHISTLE_A: Line = [
  ["E5", 2], ["D5", 0.5], ["C5", 0.5], ["A4", 1],
  ["B4", 1.5], ["C5", 0.5], ["A4", 2],
  ["E5", 1], ["G5", 1], ["F5", 1], ["E5", 1],
  ["D5", 3], [null, 1],
  ["C5", 1], ["D5", 0.5], ["E5", 0.5], ["A5", 2],
  ["G5", 1], ["F5", 1], ["E5", 2],
  ["F5", 0.5], ["E5", 0.5], ["D5", 1], ["Bb4", 1], ["C5", 1],
  ["A4", 3], [null, 1],
];

const TRUMPET_B: Line = [
  ["A4", 1.5], ["C5", 0.5], ["F5", 2],
  ["E5", 1], ["D5", 1], ["B4", 2],
  ["C5", 1.5], ["E5", 0.5], ["A5", 2],
  ["G#5", 3], [null, 1],
  ["A5", 1], ["G5", 1], ["F5", 1], ["D5", 1],
  ["F5", 1.5], ["E5", 0.5], ["D5", 2],
  ["E5", 1], ["D5", 0.5], ["C5", 0.5], ["B4", 2],
  ["A4", 3], [null, 1],
];

/** One chord per bar: bass root plus guitar tones. */
const CHORDS_A = [
  ["A2", "A3", "C4", "E4"],
  ["A2", "A3", "C4", "E4"],
  ["C3", "G3", "C4", "E4"],
  ["G2", "G3", "B3", "D4"],
  ["F2", "A3", "C4", "F4"],
  ["C3", "G3", "C4", "E4"],
  ["Bb2", "F3", "Bb3", "D4"],
  ["A2", "A3", "C4", "E4"],
];

const CHORDS_B = [
  ["F2", "A3", "C4", "F4"],
  ["G2", "G3", "B3", "D4"],
  ["A2", "A3", "C4", "E4"],
  ["E2", "G#3", "B3", "E4"],
  ["F2", "A3", "C4", "F4"],
  ["D3", "A3", "D4", "F4"],
  ["E2", "G#3", "B3", "E4"],
  ["A2", "A3", "C4", "E4"],
];

const LOOP_BARS = 16;
/** The rate the music's rendered at, and how long its echoes ring on past the end. */
const MUSIC_RATE = 32000;
const MUSIC_TAIL_SEC = 4;

function impulse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    // A desert slapback first, then a long tail. That echo is half the genre.
    const slap = Math.floor(ctx.sampleRate * (0.26 + c * 0.03));
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay) * 0.5;
    }
    for (let i = 0; i < 900 && slap + i < len; i++) d[slap + i] += (Math.random() * 2 - 1) * 0.9 * (1 - i / 900);
  }
  return buf;
}

function noiseBuffer(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/** Everything that makes sound. Works on a live or an offline context. */
class Band {
  ctx: BaseAudioContext;
  dry: GainNode;
  wet: GainNode;
  noise: AudioBuffer;

  constructor(ctx: BaseAudioContext, output: AudioNode) {
    this.ctx = ctx;
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    const verb = ctx.createConvolver();
    verb.buffer = impulse(ctx, 2.6, 2.4);
    this.wet.connect(verb);
    const verbGain = ctx.createGain();
    verbGain.gain.value = 0.55;
    verb.connect(verbGain);
    const comp = ctx.createDynamicsCompressor();
    this.dry.connect(comp);
    verbGain.connect(comp);
    comp.connect(output);
    this.noise = noiseBuffer(ctx, 1);
  }

  private env(t: number, peak: number, attack: number, hold: number, release: number) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.setValueAtTime(Math.max(0.0002, peak), t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    return g;
  }

  private send(node: AudioNode, wet: number, dry = 1) {
    const a = this.ctx.createGain();
    a.gain.value = dry;
    node.connect(a);
    a.connect(this.dry);
    const b = this.ctx.createGain();
    b.gain.value = wet;
    node.connect(b);
    b.connect(this.wet);
  }

  /** A human-sounding whistle: pure tone, wide slow vibrato, a scoop into each note, some air. */
  whistle(t: number, note: number, dur: number, from?: number) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = "sine";
    const f = midi(note);
    o.frequency.setValueAtTime(from !== undefined ? midi(from) : f * 0.96, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.075);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.6;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(f * 0.016, t + Math.min(0.5, dur));
    lfo.connect(depth);
    depth.connect(o.frequency);
    const g = this.env(t, 0.2, 0.05, Math.max(0.01, dur - 0.12), 0.11);
    o.connect(g);
    const air = ctx.createBufferSource();
    air.buffer = this.noise;
    air.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = f * 2;
    band.Q.value = 6;
    const airG = this.env(t, 0.022, 0.05, Math.max(0.01, dur - 0.12), 0.11);
    air.connect(band);
    band.connect(airG);
    this.send(g, 0.8, 0.8);
    this.send(airG, 0.7, 0.8);
    const end = t + dur + 0.2;
    o.start(t);
    o.stop(end);
    lfo.start(t);
    lfo.stop(end);
    air.start(t, Math.random() * 0.5);
    air.stop(end);
  }

  /** Twangy guitar: a plucked saw through a resonant filter that snaps shut, with tremolo. */
  twang(t: number, note: number, dur: number, level: number, wet = 0.4) {
    const ctx = this.ctx;
    const f = midi(note);
    const o1 = ctx.createOscillator();
    o1.type = "sawtooth";
    o1.frequency.setValueAtTime(f * 1.012, t);
    o1.frequency.exponentialRampToValueAtTime(f, t + 0.04);
    const o2 = ctx.createOscillator();
    o2.type = "square";
    o2.frequency.value = f * 0.998;
    const mixO2 = ctx.createGain();
    mixO2.gain.value = 0.35;
    o2.connect(mixO2);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 7;
    lp.frequency.setValueAtTime(Math.min(7000, f * 9), t);
    lp.frequency.exponentialRampToValueAtTime(f * 1.5, t + 0.2);
    const g = this.env(t, level, 0.003, 0.02, Math.max(0.1, dur));
    const trem = ctx.createGain();
    trem.gain.value = 0.82;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 6.4;
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = 0.18;
    lfo.connect(lfoAmt);
    lfoAmt.connect(trem.gain);
    o1.connect(lp);
    mixO2.connect(lp);
    lp.connect(g);
    g.connect(trem);
    this.send(trem, wet);
    const end = t + dur + 0.25;
    o1.start(t);
    o2.start(t);
    lfo.start(t);
    o1.stop(end);
    o2.stop(end);
    lfo.stop(end);
  }

  bass(t: number, note: number, dur: number) {
    const ctx = this.ctx;
    const f = midi(note);
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.value = f;
    const g = this.env(t, 0.36, 0.006, 0.03, dur);
    o.connect(g);
    this.send(g, 0.08);
    o.start(t);
    o.stop(t + dur + 0.2);
  }

  /** Coconut-shell hoofbeat: short resonant knock. */
  hoof(t: number, level: number, pitch: number) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(pitch * 1.5, t);
    o.frequency.exponentialRampToValueAtTime(pitch, t + 0.018);
    const g = this.env(t, level, 0.001, 0.003, 0.05);
    o.connect(g);
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = "bandpass";
    hp.frequency.value = pitch * 3.5;
    hp.Q.value = 3;
    const gn = this.env(t, level * 0.5, 0.001, 0.001, 0.025);
    s.connect(hp);
    hp.connect(gn);
    this.send(g, 0.12);
    this.send(gn, 0.12);
    o.start(t);
    o.stop(t + 0.1);
    s.start(t, Math.random() * 0.5);
    s.stop(t + 0.06);
  }

  whip(t: number) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(600, t);
    bp.frequency.exponentialRampToValueAtTime(7500, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.02, t + 0.11);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.125);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    s.connect(bp);
    bp.connect(g);
    this.send(g, 0.9, 0.7);
    s.start(t, Math.random() * 0.5);
    s.stop(t + 0.3);
  }

  /** Muted trumpet: bright saws through a narrow, nasal formant, with a little shake. */
  trumpet(t: number, note: number, dur: number) {
    const ctx = this.ctx;
    const f = midi(note);
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(f * 0.985, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.05);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.2;
    const d = ctx.createGain();
    d.gain.setValueAtTime(0, t);
    d.gain.linearRampToValueAtTime(f * 0.012, t + Math.min(0.6, dur));
    lfo.connect(d);
    d.connect(o.frequency);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1350;
    bp.Q.value = 2.6;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 3800;
    const g = this.env(t, 0.24, 0.03, Math.max(0.01, dur - 0.1), 0.1);
    o.connect(bp);
    bp.connect(lp);
    lp.connect(g);
    this.send(g, 0.9, 0.75);
    const end = t + dur + 0.2;
    o.start(t);
    lfo.start(t);
    o.stop(end);
    lfo.stop(end);
  }

  /** Choir pad: detuned saws through two vowel formants. */
  choir(t: number, notes: number[], dur: number) {
    const ctx = this.ctx;
    const out = this.env(t, 0.085, 0.5, Math.max(0.01, dur - 0.9), 0.7);
    const f1 = ctx.createBiquadFilter();
    f1.type = "bandpass";
    f1.frequency.value = 650;
    f1.Q.value = 3;
    const f2 = ctx.createBiquadFilter();
    f2.type = "bandpass";
    f2.frequency.value = 1100;
    f2.Q.value = 4;
    f1.connect(out);
    f2.connect(out);
    const end = t + dur + 0.3;
    for (const n of notes) {
      for (const detune of [-9, 7]) {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = midi(n);
        o.detune.value = detune;
        o.connect(f1);
        o.connect(f2);
        o.start(t);
        o.stop(end);
      }
    }
    this.send(out, 1, 0.5);
  }

  gunshot(t: number) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(7000, t);
    lp.frequency.exponentialRampToValueAtTime(380, t + 0.22);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    s.connect(lp);
    lp.connect(g);
    this.send(g, 0.8);
    s.start(t, Math.random() * 0.4);
    s.stop(t + 0.4);
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    const gl = ctx.createGain();
    gl.gain.setValueAtTime(0.85, t);
    gl.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(gl);
    this.send(gl, 0.3);
    o.start(t);
    o.stop(t + 0.3);
  }

  ricochet(t: number) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(3300 + Math.random() * 900, t);
    o.frequency.exponentialRampToValueAtTime(900, t + 0.42);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.07, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.46);
    o.connect(g);
    this.send(g, 1, 0.6);
    o.start(t);
    o.stop(t + 0.5);
  }

  /** Woody thunk and splinter crack when a target's hit. */
  thunk(t: number) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = "square";
    o.frequency.setValueAtTime(240, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.1);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(lp);
    lp.connect(g);
    this.send(g, 0.4);
    o.start(t);
    o.stop(t + 0.2);
    // The crack peaks 0.12s in, so it starts early to land on the hit. Never before time zero.
    this.whip(Math.max(0, t - 0.11));
  }

  /** Schedules one 16-bar pass of the cue, starting at t. */
  playLoop(t0: number) {
    const barT = (b: number) => t0 + b * 4 * BEAT;

    // Whistled A section, a muted trumpet answers in B.
    const line = (l: Line, startBar: number, fn: (t: number, n: number, d: number, from?: number) => void) => {
      let beat = 0;
      let prev: number | undefined;
      for (const [note, len] of l) {
        if (note) {
          const n = N[note];
          fn(barT(startBar) + beat * BEAT, n, len * BEAT * 0.97, prev);
          prev = n;
        } else {
          prev = undefined;
        }
        beat += len;
      }
    };
    line(WHISTLE_A, 0, (t, n, d, from) => this.whistle(t, n, d, from));
    line(TRUMPET_B, 8, (t, n, d) => this.trumpet(t, n, d));

    const chords = [...CHORDS_A, ...CHORDS_B];
    chords.forEach((ch, bar) => {
      const t = barT(bar);
      const [root, a, b, c] = ch.map((x) => N[x]);
      // Galloping pattern: bass on 1 and 3, a guitar figure in between.
      this.bass(t, root, BEAT * 1.4);
      this.bass(t + 2 * BEAT, root + (bar % 2 ? 7 : 0), BEAT * 1.4);
      const figure: [number, number][] = [
        [0, a],
        [0.75, b],
        [1, c],
        [1.75, b],
        [2, a],
        [2.75, b],
        [3, c],
        [3.75, b],
      ];
      for (const [beat, n] of figure) this.twang(t + beat * BEAT, n, BEAT * 0.5, 0.075, 0.3);
      // Low twang answer at the end of every other bar.
      if (bar % 2 === 1) {
        this.twang(t + 3.5 * BEAT, root + 12, BEAT * 1.2, 0.13, 0.6);
      }
      // Hooves: a three-beat gallop on repeat.
      for (let beat = 0; beat < 4; beat++) {
        this.hoof(t + beat * BEAT, 0.13, 420);
        this.hoof(t + (beat + 0.25) * BEAT, 0.08, 520);
        this.hoof(t + (beat + 0.5) * BEAT, 0.1, 340);
      }
      if (bar >= 8) this.choir(t, [a + 12, c + 12 - (c >= 64 ? 12 : 0), root + 24], 4 * BEAT);
    });
    // Whip cracks as punctuation.
    for (const b of [3, 7, 11, 15]) this.whip(barT(b) + 3.5 * BEAT);
  }
}

export class Audio {
  private ctx: AudioContext | null = null;
  private musicGain: GainNode | null = null;
  private sfxBand: Band | null = null;
  musicOn = true;

  /** Must be called from a user gesture. */
  private ensure() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = 0.8;
    master.connect(ctx.destination);
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = this.musicOn ? 0.75 : 0;
    this.musicGain.connect(master);
    void this.bakeLoop(ctx, this.musicGain);
    const sfx = ctx.createGain();
    sfx.gain.value = 0.9;
    sfx.connect(master);
    this.sfxBand = new Band(ctx, sfx);
  }

  /**
   * Renders one pass of the cue off the main thread, then just loops the recording. Playing it live means
   * thousands of oscillators scheduled from the game's own thread, which on the TV costs about 8 fps. The echoes
   * that ring past the end get folded back onto the start, so the join can't be heard.
   */
  private async bakeLoop(ctx: AudioContext, output: AudioNode) {
    const loopSeconds = LOOP_BARS * 4 * BEAT;
    const rate = MUSIC_RATE;
    const offline = new OfflineAudioContext(2, Math.ceil((loopSeconds + MUSIC_TAIL_SEC) * rate), rate);
    new Band(offline, offline.destination).playLoop(0);
    const rendered = await offline.startRendering();
    if (this.ctx !== ctx) return;
    const frames = Math.floor(loopSeconds * rate);
    const loop = ctx.createBuffer(2, frames, rate);
    for (let c = 0; c < 2; c++) {
      const from = rendered.getChannelData(c);
      const to = loop.getChannelData(c);
      to.set(from.subarray(0, frames));
      for (let i = frames; i < from.length; i++) to[i - frames]! += from[i]!;
    }
    const source = ctx.createBufferSource();
    source.buffer = loop;
    source.loop = true;
    source.connect(output);
    source.start(ctx.currentTime + 0.05);
  }

  start() {
    this.ensure();
    void this.ctx?.resume();
  }

  setMusic(on: boolean) {
    this.musicOn = on;
    this.ensure();
    if (this.musicGain && this.ctx) {
      this.musicGain.gain.setTargetAtTime(on ? 0.75 : 0, this.ctx.currentTime, 0.08);
    }
  }

  /** Ducks the music while something important happens. */
  duck(amount: number, seconds: number) {
    if (!this.ctx || !this.musicGain || !this.musicOn) return;
    const t = this.ctx.currentTime;
    this.musicGain.gain.cancelScheduledValues(t);
    this.musicGain.gain.setTargetAtTime(0.75 * amount, t, 0.02);
    this.musicGain.gain.setTargetAtTime(0.75, t + seconds, 0.4);
  }

  shot(hit: boolean) {
    this.ensure();
    if (!this.ctx || !this.sfxBand) return;
    const t = this.ctx.currentTime + 0.001;
    this.sfxBand.gunshot(t);
    if (hit) this.sfxBand.thunk(t + 0.03);
    else this.sfxBand.ricochet(t + 0.05);
    this.duck(0.4, 0.35);
  }

  /** A sound to cut to: a thud for a quick insert, a whip for a whip pan, a shot for a big hit. */
  sting(cue: "thunk" | "whip" | "blast" | "impact") {
    this.ensure();
    if (!this.ctx || !this.sfxBand) return;
    const t = this.ctx.currentTime + 0.001;
    if (cue === "thunk") this.sfxBand.thunk(t);
    else if (cue === "whip") this.sfxBand.whip(t);
    else this.shot(true);
  }

  stop() {
    void this.ctx?.close();
    this.ctx = null;
  }
}

/** Renders one pass of the cue offline and reports its level, to check it isn't silent or clipping. */
export async function measureCue(): Promise<{ seconds: number; peak: number; rms: number; clipped: number }> {
  const seconds = LOOP_BARS * 4 * BEAT + 2;
  const rate = 22050;
  const ctx = new OfflineAudioContext(2, Math.floor(seconds * rate), rate);
  const g = ctx.createGain();
  g.gain.value = 0.6;
  g.connect(ctx.destination);
  new Band(ctx, g).playLoop(0.05);
  const buf = await ctx.startRendering();
  const d = buf.getChannelData(0);
  let peak = 0;
  let sum = 0;
  let clipped = 0;
  for (let i = 0; i < d.length; i++) {
    const a = Math.abs(d[i]);
    peak = Math.max(peak, a);
    sum += a * a;
    if (a >= 1) clipped++;
  }
  return { seconds, peak, rms: Math.sqrt(sum / d.length), clipped };
}

// The phone's page: it's the game's microphone. It hears how hard you're shouting and tells the TV.

import "@fontsource/rye/400.css";
import "@fontsource/bitter/700.css";
import "@fontsource/bitter/800.css";
import "./phone.css";

import { followRoom, loudnessFrom, rmsToDb } from "../audio/voiceLevel";
import type { PhoneState } from "./protocol";

const SEND_EVERY_MS = 40;
const ATTACK_PER_SEC = 30;
/** Falls slowly, so the gaps between words don't drain the bar. */
const RELEASE_PER_SEC = 3;

const root = document.getElementById("phone")!;
const room = new URLSearchParams(location.search).get("room");

root.innerHTML = `
<h1>Fistfull of Bananas</h1>
<p class="status" data-el="status"></p>
<section class="start" data-el="start">
  <p>Your phone is the mic. Hold it near your mouth and shout to charge your shot.</p>
  <button class="big" data-el="go">Start</button>
  <p class="fine">Your phone will ask to use the mic. Nothing you say is recorded or sent, only how loud it is.</p>
</section>
<section class="play" data-el="play" hidden>
  <div class="gauge" data-el="gauge"><div class="gauge-face"><span data-el="percent">0%</span><small data-el="db"></small></div></div>
  <p class="hint">Aim with your arm. Shout to shoot the signs on the menu, and to charge your shot in a duel. Keep this page open.</p>
</section>`;

const el = <T extends HTMLElement>(name: string): T => root.querySelector<T>(`[data-el="${name}"]`)!;
const status = el("status");

let analyser: AnalyserNode | null = null;
let samples: Float32Array<ArrayBuffer> | null = null;
let audio: AudioContext | null = null;
let level = 0;
let db = -100;
let roomLevel = -50;
let roomKnown = false;
let rttMs: number | null = null;
let sending = false;
let lastTick = performance.now();

function show(text: string, kind: "good" | "bad" | "" = ""): void {
  status.textContent = text;
  status.dataset.kind = kind;
}

async function openMic(): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  audio = new AudioContext();
  await audio.resume();
  const source = audio.createMediaStreamSource(stream);
  analyser = audio.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);
  samples = new Float32Array(analyser.fftSize);
}

function readMic(dt: number): void {
  let target = 0;
  if (analyser && samples) {
    analyser.getFloatTimeDomainData(samples);
    db = rmsToDb(samples);
    if (!roomKnown) {
      roomLevel = Math.max(db, -65);
      roomKnown = true;
    }
    roomLevel = followRoom(roomLevel, db, dt);
    target = loudnessFrom(db, roomLevel);
  }
  const rate = target > level ? ATTACK_PER_SEC : RELEASE_PER_SEC;
  level += (target - level) * Math.min(1, rate * dt);
}

async function send(): Promise<void> {
  // One at a time, always the latest, so a slow moment never builds up a queue.
  if (sending) return;
  sending = true;
  const message: PhoneState = { level, db, mic: analyser !== null, rttMs };
  const sentAt = performance.now();
  try {
    const response = await fetch(`/phone-relay/send?room=${encodeURIComponent(room!)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });
    rttMs = performance.now() - sentAt;
    const answer = (await response.json()) as { tv?: boolean };
    if (answer.tv) show(`Connected to the TV (${Math.round(rttMs)} ms)`, "good");
    else show("Can't find the TV. Is the game open on it?", "bad");
  } catch {
    show("Lost the connection. Are you on the same Wi-Fi as the TV?", "bad");
  } finally {
    sending = false;
  }
}

function tick(): void {
  const now = performance.now();
  const dt = Math.min(0.2, (now - lastTick) / 1000);
  lastTick = now;
  readMic(dt);
  el("gauge").style.setProperty("--fill", level.toFixed(3));
  el("percent").textContent = `${Math.round(level * 100)}%`;
  el("db").textContent = analyser ? `${Math.round(db)} dB` : "No mic";
  void send();
}

async function start(): Promise<void> {
  try {
    await openMic();
  } catch {
    show("Couldn't get the mic. Check this site's permissions.", "bad");
    return;
  }
  el("start").hidden = true;
  el("play").hidden = false;
  try {
    await navigator.wakeLock?.request("screen");
  } catch {
    // Only means the screen may dim. Everything else still works.
  }
  window.setInterval(tick, SEND_EVERY_MS);
}

if (!room) {
  el("start").hidden = true;
  show("Scan the code on the TV to play.", "bad");
} else if (!window.isSecureContext) {
  el("start").hidden = true;
  show("This page needs https to use the mic.", "bad");
} else {
  el("go").addEventListener("click", () => void start());
}

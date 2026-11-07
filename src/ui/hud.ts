// The Wild West HUD and screens, drawn in the DOM over the WebGL canvas. Sizes are px on
// the 1920x1080 canvas. Text the agent should read carries data-little annotations.

import type { AimLevel } from "../game/settings";
import { GUNS } from "../game/guns";
import { ownsGun, type Wallet } from "../game/wallet";
import { BOSS } from "../game/boss";
import type { Grade, HighScore, InitialsEntry, RunStats, WaveReport } from "../game/arcade";
import { CHAMBERS } from "../../lookdev/gun";
import { OUTFITS } from "../../lookdev/character";
import { logoSvg } from "../../lookdev/logo";
import type { Match, PlayerId, Winner } from "../game/match";
import { RUSH, projectToScreen, rushCamStage, type DodgeMove, type Rush } from "../game/rush";
import { TOTAL_STEPS, type Tutorial } from "../game/tutorial";
import type { CameraCheckState } from "../game/cameraCheck";
import { DEFAULT_RULES, INTRO, KILLCAM, PLANE, damageFor, hitZone, introStage, killCamStage, nearestPointOnBody, planeToScreen, reticleHits, type Rules, type Vec2 } from "../game/rules";

export interface HudActions {
  start(players: 1 | 2): void;
  rematch(): void;
  quit(): void;
  resume(): void;
  sound(): void;
}

/** What each aim level's called on the settings screen, and what to expect from it. */
const AIM_LEVEL_TEXT: Record<AimLevel, { name: string; hint: string }> = {
  off: { name: "Off", hint: "No help. Just you and your arm." },
  soft: { name: "Soft", hint: "A light nudge when you're close to a target." },
  normal: { name: "Normal", hint: "Holds on to targets until you move away." },
  hard: { name: "Hard lock", hint: "Sticks hard. It takes a big move to pull free." },
};

export type Screen = "menu" | "match" | "title" | "rush" | "shop" | "settings" | "opening" | "camera";

/** How much of the gap the score closes each frame as it tallies up. */
const SCORE_TALLY_RATE = 0.16;

const HEART_SVG = `<svg class="rush-heart" viewBox="0 0 100 92" aria-hidden="true"><path d="M50 88 C18 62 4 44 4 27 C4 13 15 4 28 4 C37 4 45 9 50 18 C55 9 63 4 72 4 C85 4 96 13 96 27 C96 44 82 62 50 88 Z"/></svg>`;

const MARK_SVG = `<g class="spin"><circle r="34"/><path d="M0 -46 V-24 M0 46 V24 M-46 0 H-24 M46 0 H24"/></g><circle class="dot" r="4"/>`;

function name(match: Match, player: PlayerId): string {
  if (match.mode === 1) return player === 0 ? "You" : "The Dummy";
  return player === 0 ? "Player 1" : "Player 2";
}

export class Hud {
  private readonly el: Record<string, HTMLElement> = {};
  private readonly reticle: HTMLElement;
  private readonly hud: HTMLElement;
  private lastScreenKey = "";
  private lastPrompt = "";
  /** Whether the camera is following someone, which changes what the prompts suggest. */
  tracking = false;
  private shownHearts = -1;
  private shownScore = 0;
  private shownBossShare = 1;
  /** Points that have finished flying to the tally. */
  private landedScore = 0;
  /** Seconds into the staredown, or null when there isn't one on. */
  private faceoffT: number | null = null;
  private shownMove: DodgeMove | null = null;
  private bannerTimer = 0;

  constructor(
    host: HTMLElement,
    private readonly actions: HudActions,
  ) {
    this.hud = document.createElement("div");
    this.hud.className = "hud";
    this.hud.innerHTML = TEMPLATE;
    host.appendChild(this.hud);
    this.hud.querySelectorAll<HTMLElement>("[data-el]").forEach((node) => {
      this.el[node.dataset.el!] = node;
    });
    this.reticle = this.el.reticle!;
    this.el.logo!.innerHTML = logoSvg();
    this.el.titleLogo!.innerHTML = logoSvg();
    this.buildCylinderReticle();

    this.on("rematch", () => actions.rematch());
    this.on("quitResults", () => actions.quit());
    this.on("resume", () => actions.resume());
    this.on("quitPause", () => actions.quit());

    window.addEventListener("keydown", (e) => this.navigate(e));
  }

  private on(element: string, handler: () => void): void {
    this.el[element]!.addEventListener("click", () => {
      this.actions.sound();
      handler();
    });
  }

  /** The menus work with the remote alone: arrows move, Select presses. */
  private navigate(e: KeyboardEvent): void {
    const forward = e.code === "ArrowDown" || e.code === "ArrowRight";
    const backward = e.code === "ArrowUp" || e.code === "ArrowLeft";
    if (!forward && !backward) return;
    const open = this.hud.querySelector<HTMLElement>(".screen.open");
    if (!open) return;
    const buttons = [...open.querySelectorAll<HTMLButtonElement>("button:not([tabindex='-1'])")];
    if (buttons.length === 0) return;
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const step = forward ? 1 : -1;
    const next = at < 0 ? 0 : (at + step + buttons.length) % buttons.length;
    buttons[next]!.focus();
    this.actions.sound();
    e.preventDefault();
  }

  private setScreen(key: string): void {
    if (key === this.lastScreenKey) return;
    this.lastScreenKey = key;
    this.hud.querySelectorAll<HTMLElement>(".screen").forEach((node) => {
      node.classList.toggle("open", node.dataset.screen === key);
    });
    const first = this.hud.querySelector<HTMLButtonElement>(`.screen.open button:not([tabindex="-1"])`);
    first?.focus();
    if (!first && document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }

  /**
   * The tutorial's instructions, over the practice lizard. `mark` is where his nuts are on screen.
   * `done` is the moment after the shot, while the x-ray plays. Null clears them.
   */
  updateTutorial(tutorial: Tutorial | null, tracking: boolean, mark: Vec2 | null = null, done = false): void {
    this.hud.dataset.tutorial = !tutorial ? "" : done ? "done" : tutorial.step;
    if (!tutorial) return;
    this.text("tutStep", done ? "" : `Step ${tutorial.number} of ${TOTAL_STEPS}`);
    if (done) {
      this.text("tutTitle", "");
      this.text("tutNote", "");
    } else if (tutorial.step === "aim") {
      this.text("tutTitle", tracking ? "Point your arm at the lizard" : "Aim at the lizard");
      this.text("tutNote", tracking ? "Your arm moves the crosshair. If the camera loses you, the arrows take over." : "Use the arrows on the remote, or the mouse.");
    } else if (tutorial.step === "nuts") {
      this.text("tutTitle", "Now aim for his nuts");
      this.text("tutNote", "Nut shots and headshots score more, and get the x-ray.");
    } else {
      this.text("tutTitle", "Locked on. Press OK to shoot");
      this.text("tutNote", "Out of bullets? Shake your hand to reload.");
    }
    if (mark) {
      this.el.tutMark!.style.left = `${mark.x * 100}%`;
      this.el.tutMark!.style.top = `${mark.y * 100}%`;
    }
  }

  /** The camera check: what it needs from you, the ring in the middle, and where your arm's pointing. */
  updateCameraCheck(state: CameraCheckState, held: number, aim: Vec2 | null): void {
    this.hud.dataset.camcheck = state;
    const copy: Record<CameraCheckState, [string, string]> = {
      none: ["This game needs a camera", "You aim by pointing your arm at the screen. Plug in the Little camera, switch it on, and face the TV."],
      looking: ["Looking for you...", "Stand about two metres back, so the camera can see you from the waist up."],
      point: ["Point at the ring", "Hold your arm out straight at the screen until the ring fills."],
      done: ["Got you!", "The camera can see you. Let's ride."],
    };
    const [title, note] = copy[state];
    this.text("camTitle", title);
    this.text("camNote", note);
    this.text("camSkip", state === "none" ? "Press OK to play with the remote instead" : state === "done" ? "" : "Press OK to play without the camera");
    this.el.camRing!.style.setProperty("--held", held.toFixed(3));
    const hand = this.el.camHand!;
    hand.hidden = state !== "point" || !aim;
    if (aim) {
      hand.style.left = `${aim.x * 100}%`;
      hand.style.top = `${aim.y * 100}%`;
    }
    this.el.camCheck!.dataset.littleData = JSON.stringify({ step: state, held: Math.round(held * 100) / 100 });
  }

  /** Shows the small crosshair for pressing buttons, on screens with no reticle of their own. */
  updatePointer(mouse: Vec2, used: boolean): void {
    const node = this.el.pointer!;
    const open = this.hud.querySelector(".screen.open:not(.menu)") !== null;
    node.hidden = !(used && open);
    node.style.left = `${mouse.x * 100}%`;
    node.style.top = `${mouse.y * 100}%`;
  }

  /** Runs the title over the sun. */
  showTitle(on: boolean): void {
    this.hud.dataset.title = on ? "on" : "";
  }

  /** One quick flash of the whole screen as the gun goes off. */
  shotFlash(): void {
    const node = this.el.shotFlash!;
    node.classList.remove("go");
    void node.offsetWidth;
    node.classList.add("go");
  }

  /** The hard flash that cuts from the title into the menu. */
  impactFlash(): void {
    const node = this.el.impact!;
    node.classList.remove("go");
    void node.offsetWidth;
    node.classList.add("go");
  }

  /** Rush mode's readouts. Runs each frame while it's up. */
  updateRush(game: Rush, usingCamera: boolean): void {
    this.usingCamera = usingCamera;
    this.updateHearts(game.hearts);
    // The tally counts up to what's landed on it, so every point can be seen arriving.
    const target = game.over ? game.score : this.landedScore;
    this.shownScore += (target - this.shownScore) * SCORE_TALLY_RATE;
    if (target - this.shownScore < 1) this.shownScore = target;
    this.text("rushScore", String(Math.round(this.shownScore)));
    this.updateRushMeters(game);
    const boss = game.phase === "bossShoot" || game.phase === "bossCharge" || game.phase === "bossDodge" || game.phase === "won";
    const between = game.phase === "travel" || game.phase === "arena" || game.phase === "bossDrop" || game.phase === "challenge";
    this.text("rushWave", boss || between ? "" : `Wave ${game.wave + 1} of ${game.waves}`);
    this.text("rushHelp", usingCamera || !game.canShoot ? "" : "Mouse aims. Click shoots. A and D lean. S ducks. R reloads.");
    this.placeReticle(game.aim.x, game.aim.y);
    this.reticle.classList.toggle("on-target", game.onTarget);
    this.text("reticleZone", "");
    this.hud.dataset.gun = game.canShoot && !game.cam ? "up" : "";

    const bossBar = this.el.rushBoss!;
    bossBar.hidden = !boss || game.over;
    if (boss) this.updateBossBar(game);

    this.updateRushWord(game.wordMove);
    this.updateCannonAlert(game);
    this.updateStrikeMarks(game);
    this.updateThrownMarks(game);

    // The kill cam's own effects, driven the same way the duel drives them.
    const cam = game.cam;
    const stage = cam ? rushCamStage(cam.t) : null;
    this.hud.dataset.killcam = stage?.name === "xray"
      ? stage.t < KILLCAM.frameSec
        ? stage.t < KILLCAM.frameSwapSec ? "frame-light" : "frame-dark"
        : "xray"
      : "";
    this.hud.dataset.zone = "";
    this.hud.dataset.rushcam = cam ? "on" : "";

    if (game.over) {
      this.text("rushTitle", game.phase === "won" ? "You held the town!" : "They got you!");
      this.text("rushStat", `${game.kills} down. Score: ${game.score}`);
    }
    this.setScreen(game.over ? "rushEnd" : "");
  }

  /** Ammo, the combo and dead-eye, plus the prompts that go with them. */
  private updateRushMeters(game: Rush): void {
    const ammoBar = this.el.rushAmmo!;
    // Different guns hold different amounts.
    const pips = Number.isFinite(game.maxAmmo) ? game.maxAmmo : RUSH.ammo;
    if (ammoBar.children.length !== pips) {
      ammoBar.innerHTML = "<i></i>".repeat(pips);
      ammoBar.classList.toggle("many", pips > 10);
    }
    const bullets = ammoBar.children;
    const reloading = game.reload !== null;
    // Fills back up one bullet at a time, as each goes into the gun.
    for (let i = 0; i < bullets.length; i++) {
      bullets[i]!.classList.toggle("spent", i >= game.ammo);
    }
    this.el.rushAmmo!.classList.toggle("reloading", reloading);
    this.el.rushCombo!.dataset.steps = String(game.multiplier);
    this.el.rushScoreBox!.dataset.heat = String(game.multiplier);
    this.text("rushMultiplier", game.multiplier > 1 ? `x${game.multiplier}` : "");
    this.el.rushDeadEyeFill!.style.width = `${game.deadEye * 100}%`;
    this.hud.dataset.deadeye = game.deadEyeLeft > 0 ? "on" : game.deadEyeReady ? "ready" : "";

    const camera = this.usingCamera;
    const locked = game.deadEyeLeft > 0;
    const note = !game.canShoot ? ""
      : locked ? "Locked on! Press OK!"
      : reloading ? "Reloading!"
      : game.ammo <= 0 ? (camera ? "Shake your hand to reload!" : "Press R to reload!")
      : "";
    this.text("rushNote", note);
    this.el.rushNote!.hidden = note === "";
    // The ones that want you to do something right now are the big ones.
    this.el.rushNote!.classList.toggle("big", locked || game.ammo <= 0);
  }

  /** The score jumps and flashes on a kill, and the combo stamp pops up with it. */
  rushKill(): void {
    const node = this.el.rushScoreBox!;
    node.classList.remove("hit");
    void node.offsetWidth;
    node.classList.add("hit");
  }

  rushCombo(combo: number, multiplier: number): void {
    const node = this.el.rushCombo!;
    node.textContent = `${combo} in a row! x${multiplier}`;
    node.style.setProperty("--size", String(0.8 + multiplier * 0.2));
    node.classList.remove("pop");
    void node.offsetWidth;
    node.classList.add("pop");
  }

  /**
   * Points popping up right on a kill, with its word if it earned one: they punch in, hang for a
   * moment, then fly up into the tally, which is when they count.
   */
  rushScore(at: Vec2, points: number, label: string, options: { boost?: number; sec?: number } = {}): void {
    const box = this.el.rushFloats!;
    const node = document.createElement("div");
    node.className = label ? "rush-float big" : "rush-float";
    node.innerHTML = (label ? `<b>${label}</b>` : "") + `<span>+${points}</span>`;
    // The more it's worth, the harder it hits.
    const pop = Math.min(1.5, 0.82 + points / 800) * (options.boost ?? 1);
    node.style.setProperty("--pop", pop.toFixed(2));
    const tilt = (Math.random() * 2 - 1) * 7;
    // Measured, because the page is only 1920 wide on the TV itself.
    const x = at.x * this.hud.clientWidth;
    const y = at.y * this.hud.clientHeight;
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    box.appendChild(node);
    const toX = this.hud.clientWidth / 2 - x;
    const toY = 60 - y;
    const land = (): void => {
      node.remove();
      this.landedScore += points;
      this.rushKill();
    };
    const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (calm || !node.animate) {
      window.setTimeout(land, 500);
      return;
    }
    // Slams in oversized, snaps back, wobbles, hangs there to be read, and only then goes to the tally.
    node.animate([
      { transform: `translate(-50%, -50%) scale(2.6) rotate(${tilt * 2}deg)`, opacity: 0, offset: 0, easing: "cubic-bezier(.3,1.5,.5,1)" },
      { transform: `translate(-50%, -80%) scale(0.86) rotate(${-tilt}deg)`, opacity: 1, offset: 0.08, easing: "ease-out" },
      { transform: `translate(-50%, -95%) scale(1.14) rotate(${tilt * 0.6}deg)`, offset: 0.16, easing: "ease-in-out" },
      { transform: `translate(-50%, -100%) scale(1) rotate(${tilt * 0.3}deg)`, offset: 0.25 },
      { transform: `translate(-50%, -112%) scale(1) rotate(${tilt * 0.3}deg)`, offset: 0.68, easing: "cubic-bezier(.6,-.25,.8,.3)" },
      { transform: `translate(calc(-50% + ${toX}px), calc(-112% + ${toY}px)) scale(0.3)`, offset: 1 },
    ], { duration: (options.sec ?? 1.25) * 1000 }).onfinish = land;
  }

  /** A little word over the action, like a hat shot's bonus. */
  rushCallout(text: string): void {
    const node = this.el.rushCallout!;
    node.textContent = text;
    node.classList.remove("pop");
    void node.offsetWidth;
    node.classList.add("pop");
  }

  /** The boss's health: a hit snaps off a chunk, which flies away, and a pale bar drains down after it. */
  private updateBossBar(game: Rush): void {
    const share = Math.max(0, game.bossHp / BOSS.hp);
    const bar = this.el.rushBoss!;
    bar.dataset.state = game.bossInvulnerable ? "shielded" : game.heartOpen ? "heart" : "";
    if (share === this.shownBossShare) return;
    const was = this.shownBossShare;
    this.shownBossShare = share;
    this.el.rushBossFill!.style.width = `${share * 100}%`;
    this.el.rushBossLag!.style.width = `${share * 100}%`;
    if (share > was) return;
    const track = this.el.rushBossTrack!;
    const chunk = document.createElement("i");
    chunk.className = "rush-boss-chunk";
    chunk.style.left = `${share * 100}%`;
    chunk.style.width = `${(was - share) * 100}%`;
    track.appendChild(chunk);
    const big = was - share > 0.02;
    const fall = big ? 110 : 44;
    chunk.animate(
      [
        { transform: "translateY(0) rotate(0deg)", opacity: 1 },
        { transform: `translate(${big ? 40 : 14}px, ${fall}px) rotate(${big ? 24 : 8}deg)`, opacity: 0 },
      ],
      { duration: big ? 620 : 300, easing: "cubic-bezier(.3,0,.8,.6)" },
    ).onfinish = () => chunk.remove();
    const shove = big ? 12 : 4;
    bar.animate(
      [
        { transform: `translate(${shove}px, ${shove / 2}px)` },
        { transform: `translate(${-shove * 0.6}px, 0)` },
        { transform: "translate(0, 0)" },
      ],
      { duration: big ? 260 : 120 },
    );
  }

  /** A wave's report card, which stamps itself together line by line while the street's quiet. */
  rushTally(report: WaveReport): void {
    const node = this.el.rushTally!;
    const lines: [string, string][] = [
      ["Kills", String(report.kills)],
      ["Accuracy", `${Math.round(report.accuracy * 100)}%`],
      ["Best combo", String(report.bestCombo)],
      ["Hearts lost", String(report.heartsLost)],
    ];
    node.innerHTML = `
      <h3>Wave ${report.wave} clear!</h3>
      <dl>${lines.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>
      <p class="rush-tally-bonus">Bonus +${report.bonus}</p>
      <b class="rush-grade grade-${report.grade.toLowerCase()}">${report.grade}</b>`;
    node.classList.remove("show");
    void node.offsetWidth;
    node.classList.add("show");
  }

  /** The end screen: how the run went, the high score table, and the initials being typed, if any. */
  rushResults(summary: RunStats & { grade: Grade; accuracy: number }, table: readonly HighScore[], entry: InitialsEntry | null, score: number): void {
    const grade = this.el.rushFinalGrade!;
    grade.textContent = summary.grade;
    grade.className = `rush-grade grade-${summary.grade.toLowerCase()}`;
    this.text("rushAccuracy", `${Math.round(summary.accuracy * 100)}% accuracy. Best combo ${summary.bestCombo}.`);
    const rows = table.map((s, i) => {
      const mine = !entry && s.score === score;
      return `<li class="${mine ? "mine" : ""}"><span>${i + 1}</span><b>${s.name}</b><i>${s.score}</i></li>`;
    });
    this.el.rushScores!.innerHTML = rows.join("");
    const box = this.el.rushEntry!;
    box.hidden = !entry;
    if (entry) {
      box.innerHTML = `<p>New high score! Up and down pick a letter. OK locks it in.</p><div class="rush-initials">${
        entry.name.split("").map((c, i) => `<b class="${i === entry.cursor ? "on" : ""}">${c}</b>`).join("")
      }</div>`;
    }
    this.text("rushEndNote", entry ? "" : "Press OK to go back to town.");
  }

  /** You've been hit: one beat of red in from the edges of the screen, and gone. Never repeats on its own. */
  rushHurt(): void {
    this.el.rushHurt!.animate(
      [{ opacity: 1 }, { opacity: 0.8, offset: 0.2 }, { opacity: 0 }],
      { duration: 420, easing: "ease-out" },
    );
  }

  /** Lives as hearts: a lost one goes dark, with a pop so it can't be missed. */
  private updateHearts(hearts: number): void {
    if (hearts === this.shownHearts) return;
    this.shownHearts = hearts;
    this.el.rushHearts!.querySelectorAll<HTMLElement>(".rush-heart").forEach((node, i) => {
      node.classList.toggle("lost", i >= hearts);
    });
  }

  /** The word for dodging time: it pops in, then keeps pulsing, with an arrow to its side. */
  private updateRushWord(move: DodgeMove | null): void {
    if (move === this.shownMove && move !== null) return;
    this.shownMove = move;
    const node = this.el.rushWord!;
    node.dataset.move = move ?? "";
    if (!move) return;
    node.textContent = move === "left" ? "\u25C0 LEAN LEFT" : move === "right" ? "LEAN RIGHT \u25B6" : "\u25BC DUCK \u25BC";
    node.classList.remove("pop");
    void node.offsetWidth;
    node.classList.add("pop");
  }

  /** A red mark over anyone about to hit you, so you know who to shoot first. */
  private updateStrikeMarks(game: Rush): void {
    let used = 0;
    if (!game.cam) {
      for (const enemy of game.attackers) {
        const node = this.el[`rushStrike${used}`];
        const at = projectToScreen(enemy.x, 3.15, enemy.z, game.cameraX, game.cameraY);
        if (!node || !at) continue;
        node.toggleAttribute("hidden", false);
        node.style.left = `${at.x * 100}%`;
        node.style.top = `${Math.max(0.1, at.y) * 100}%`;
        used += 1;
      }
    }
    for (; this.el[`rushStrike${used}`]; used++) this.el[`rushStrike${used}`]!.toggleAttribute("hidden", true);
  }

  /** A great big exclamation mark over the cannon, popped in once while the fuse burns. */
  private updateCannonAlert(game: Rush): void {
    const node = this.el.rushAlert!;
    const at = game.cam ? null : game.cannonAlertAt;
    if (!at) {
      node.toggleAttribute("hidden", true);
      node.classList.remove("pop");
      return;
    }
    node.style.left = `${at.x * 100}%`;
    node.style.top = `${at.y * 100}%`;
    if (node.hasAttribute("hidden")) {
      node.toggleAttribute("hidden", false);
      void (node as unknown as SVGGraphicsElement).getBoundingClientRect();
      node.classList.add("pop");
    }
  }

  /** A target reticle on anything thrown. */
  private updateThrownMarks(game: Rush): void {
    let used = 0;
    for (const thrown of game.thrown) {
      const node = this.el[`rushMark${used}`];
      const p = projectToScreen(thrown.x, thrown.y, thrown.z, game.cameraX, game.cameraY);
      if (!node || !p) continue;
      // SVGs have no hidden property, so this has to set the attribute itself.
      node.toggleAttribute("hidden", Boolean(game.cam));
      this.placeAt(node, p.x, p.y);
      used += 1;
    }
    for (; this.el[`rushMark${used}`]; used++) this.el[`rushMark${used}`]!.toggleAttribute("hidden", true);
    const whiskey = this.el.rushWhiskey!;
    const w = game.whiskey;
    const p = w ? projectToScreen(w.x, w.y, w.z, game.cameraX, game.cameraY) : null;
    whiskey.hidden = !p || Boolean(game.cam);
    if (p) {
      whiskey.style.left = `${p.x * 100}%`;
      whiskey.style.top = `${p.y * 100}%`;
    }
  }

  /** A short call-out over rush mode, like the wave number. */
  rushBanner(text: string): void {
    const node = this.el.banner!;
    this.el.bannerText!.textContent = text;
    node.classList.remove("show");
    void node.offsetWidth;
    node.classList.add("show");
  }

  /** The staredown before the boss: the same bars, names and slash as a duel's opening. */
  showRushFaceoff(t: number | null, bossName: string): void {
    this.faceoffT = t;
    if (t === null) return;
    const stage = introStage(t);
    this.text("introA", "You");
    this.text("introB", bossName);
    this.text("introSolo", stage === "first" ? "You" : bossName);
    this.el.introSolo!.dataset.player = stage;
  }

  update(screen: Screen, match: Match | null, paused: boolean): void {
    if (screen !== "rush") {
      this.shownScore = 0;
      this.landedScore = 0;
    }
    if (screen === "rush") {
      const staring = this.faceoffT !== null;
      this.hud.dataset.phase = staring ? "intro" : "rush";
      this.hud.dataset.intro = staring ? introStage(this.faceoffT!) : "";
      return;
    }
    this.hud.dataset.rushcam = "";
    this.hud.dataset.gun = "";
    this.hud.dataset.deadeye = "";
    if (screen === "title" || screen === "menu" || !match) {
      this.hud.dataset.zone = "";
      this.hud.dataset.killcam = "";
      this.hud.dataset.intro = "";
    }
    if (screen === "title") {
      this.hud.dataset.phase = "title";
      this.setScreen("");
      return;
    }
    if (screen === "opening") {
      this.hud.dataset.phase = "opening";
      this.setScreen("");
      return;
    }
    if (screen === "camera") {
      this.hud.dataset.phase = "camera";
      this.setScreen("camera");
      return;
    }
    if (screen === "shop" || screen === "settings") {
      this.hud.dataset.phase = "menu";
      this.setScreen(screen);
      return;
    }
    if (screen === "menu" || !match) {
      this.hud.dataset.phase = "menu";
      this.setScreen("menu");
      return;
    }
    const { phase } = match;
    this.hud.dataset.phase = phase;
    const stage = phase === "impact" ? killCamStage(match.phaseTime, match.shot?.zone ?? null, match.rules, match.shot?.xray) : "over";
    const big = phase === "impact" && (match.shot?.zone === "head" || match.shot?.zone === "nuts" || match.shot?.xray === true);
    // The stamp and shake land with the crunch, not the impact frame.
    this.hud.dataset.zone = big && stage !== "frame" && stage !== "approach" ? match.shot!.zone! : "";
    this.hud.dataset.killcam = big && stage !== "over"
      ? stage === "frame"
        ? match.phaseTime < KILLCAM.frameSwapSec ? "frame-light" : "frame-dark"
        : "xray"
      : "";
    this.setScreen(paused ? "pause" : phase === "handoff" ? "handoff" : phase === "results" ? "results" : "");

    this.updatePlates(match);
    switch (phase) {
      case "intro":
        this.updateIntro(match);
        break;
      case "handoff":
        this.updateHandoff(match);
        break;
      case "aim":
        this.updateAim(match);
        break;
      case "shot":
        // Never hints at the outcome, so the slow motion keeps its tension.
        this.text("caption", "Here it comes!");
        break;
      case "impact":
        this.updateImpact(match);
        break;
      case "results":
        this.updateResults(match, match.winner!);
        break;
    }
  }

  /** The menu's reticle is the gun's cylinder: spent chambers go dark as it clicks round. */
  private buildCylinderReticle(): void {
    const holes: string[] = [];
    const notches: string[] = [];
    for (let i = 0; i < CHAMBERS; i++) {
      const a = (i / CHAMBERS) * Math.PI * 2 - Math.PI / 2;
      holes.push(`<g class="ch" transform="translate(${(Math.cos(a) * 36).toFixed(2)} ${(Math.sin(a) * 36).toFixed(2)})"><circle class="hole" r="12.5"/><circle class="brass" r="9.5"/><circle class="primer" r="3.2"/></g>`);
      notches.push(`<path class="notch" d="M50 -5 L60 -7 L60 7 L50 5Z" transform="rotate(${((i + 0.5) / CHAMBERS) * 360 - 90})"/>`);
    }
    this.el.cylinder!.innerHTML = `<svg viewBox="-70 -70 140 140"><g class="spin"><circle class="body" r="53"/>${notches.join("")}${holes.join("")}</g><circle class="pin" r="6"/><path class="tick" d="M0 -68 L0 -56 M0 68 L0 56 M-68 0 L-56 0 M68 0 L56 0"/></svg>`;
  }

  /** How many coins you've got, on the menu. */
  showCoins(coins: number, dev = false): void {
    this.text("menuCoins", `${dev ? "DEV  " : ""}${coins.toLocaleString("en-US")}`);
  }

  /** What the run paid, on the end screen. */
  rushCoins(earned: number, total: number): void {
    this.text("rushCoins", `+${earned.toLocaleString("en-US")} coins. ${total.toLocaleString("en-US")} in the bank.`);
  }

  private hudWidth = 0;
  private hudHeight = 0;

  /** A move by transform doesn't lay out or repaint the page, which at 30 times a second on a TV matters. */
  private placeAt(node: HTMLElement | SVGElement, x: number, y: number, after = ""): void {
    if (this.hudWidth === 0) {
      this.hudWidth = this.hud.offsetWidth;
      this.hudHeight = this.hud.offsetHeight;
      window.addEventListener("resize", () => (this.hudWidth = 0), { once: true });
    }
    node.style.transform = `translate3d(${(x * this.hudWidth).toFixed(1)}px, ${(y * this.hudHeight).toFixed(1)}px, 0)${after}`;
  }

  private placeReticle(x: number, y: number): void {
    this.placeAt(this.reticle, x, y, " translate(-50%, -50%)");
  }

  private usingCamera = false;
  private shopKey = "";

  /** The outfits screen: what the gun on the turntable is, what it does, and what OK will do to it. */
  updateShop(wallet: Wallet, selected: number): void {
    const key = `${wallet.coins}|${wallet.equipped}|${wallet.owned.join()}|${wallet.dev ?? false}|${selected}`;
    if (key === this.shopKey) return;
    this.shopKey = key;
    this.text("shopCoins", `${wallet.dev ? "DEV  " : ""}${wallet.coins.toLocaleString("en-US")}`);
    const gun = GUNS[selected];
    const owned = gun ? ownsGun(wallet, gun.id) : false;
    const inHand = gun?.id === wallet.equipped;
    this.text("shopName", gun?.name ?? "Back to the street");
    this.text("shopBlurb", gun?.blurb ?? "They won't shoot themselves.");
    this.text("shopStats", !gun ? "" : `${gun.ammo} shots · ${gun.auto ? "Hold OK to keep firing" : "One shot a press"} · ${gun.mag ? "Quick magazine" : "Loads a bullet at a time"}`);
    const price = this.el.shopPrice!;
    price.textContent = !gun ? "" : inHand ? "In your hand" : owned ? "Yours" : `${gun.price.toLocaleString("en-US")} coins`;
    price.classList.toggle("cant", Boolean(gun && !owned && wallet.coins < gun.price));
    price.classList.toggle("mine", owned);
    // A dot for each stop along the row, which is also what the agent reads.
    const dots = GUNS.map((g, i) => {
      const mine = ownsGun(wallet, g.id);
      const data = JSON.stringify({ price: g.price, owned: mine, equipped: g.id === wallet.equipped }).replace(/"/g, "&quot;");
      return `<i class="${i === selected ? "on" : ""}${mine ? " mine" : ""}" data-little="item" data-little-id="${g.id}" data-little-label="${g.name}" data-little-data="${data}" data-little-action="equip_gun"></i>`;
    });
    dots.push(`<i class="back${selected === GUNS.length ? " on" : ""}"></i>`);
    this.el.shopCards!.innerHTML = dots.join("");
    this.text("shopHint", !gun ? "OK to go back."
      : inHand ? "Left and right for more guns."
      : owned ? "OK to use this one."
      : wallet.coins >= gun.price ? `OK to buy it.`
      : `You need ${(gun.price - wallet.coins).toLocaleString("en-US")} more coins. Win some fights.`);
  }

  /** The settings screen: which row's picked, and what each is set to. */
  updateSettings(aimLevel: AimLevel, dev: boolean, selected: number): void {
    this.el.settingsAim!.classList.toggle("selected", selected === 0);
    this.el.settingsDev!.classList.toggle("selected", selected === 1);
    this.el.settingsBack!.classList.toggle("selected", selected === 2);
    this.text("settingsAimValue", AIM_LEVEL_TEXT[aimLevel].name);
    this.el.settingsAim!.classList.toggle("off", aimLevel === "off");
    this.text("settingsDevValue", dev ? "On" : "Off");
    this.el.settingsDevValue!.classList.toggle("on", dev);
    this.text("settingsHint", selected === 0 ? AIM_LEVEL_TEXT[aimLevel].hint
      : selected === 1 ? (dev ? "OK to turn it off. Every gun's free while it's on." : "OK to turn it on. It makes every gun free.")
      : "OK to go back.");
  }

  /** Runs each frame while the gallery menu is up. */
  updateMenu(aim: Vec2, onTarget: boolean, shots: number): void {
    const cylinder = this.el.cylinder!;
    this.placeAt(cylinder, aim.x, aim.y);
    cylinder.classList.toggle("on", onTarget);
    const spin = cylinder.querySelector<SVGGElement>(".spin");
    if (spin) spin.style.transform = `rotate(${-shots * (360 / CHAMBERS)}deg)`;
    cylinder.querySelectorAll(".ch").forEach((el, i) => el.classList.toggle("spent", i < shots));
  }

  /** A short stamped message on the menu. */
  banner(text: string, seconds: number): void {
    const node = this.el.menuBanner!;
    node.textContent = text;
    node.classList.remove("show");
    void node.offsetWidth;
    node.classList.add("show");
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => node.classList.remove("show"), seconds * 1000);
  }

  /** Clears the loading message once the models and town are ready. */
  /** Lays out and paints the fight's HUD once, under the loading screen. */
  prewarm(on: boolean): void {
    this.hud.dataset.phase = on ? "rush" : "";
    this.hud.dataset.gun = on ? "up" : "";
  }

  loaded(): void {
    this.el.loading!.hidden = true;
  }

  fail(message: string): void {
    this.el.loading!.hidden = false;
    this.el.loading!.textContent = `The town didn't load: ${message}`;
  }

  private text(element: string, value: string): void {
    const node = this.el[element]!;
    if (node.textContent !== value) node.textContent = value;
  }

  private updateIntro(match: Match): void {
    const stage = introStage(match.phaseTime);
    this.hud.dataset.intro = stage;
    this.text("introA", name(match, 0));
    this.text("introB", name(match, 1));
    this.text("introSolo", name(match, stage === "first" ? 0 : 1));
    // The name re-slams when the shot changes, because it's a new element state.
    this.el.introSolo!.dataset.player = stage;
  }

  private updatePlates(match: Match): void {
    for (const player of [0, 1] as const) {
      // Plates wear the colour of that duellist's poncho.
      const outfit = match.mode === 1 && player === 1 ? 3 : player;
      this.el[`plate${player}`]!.style.setProperty("--poncho", OUTFITS[outfit]!.poncho);
      const hp = match.health[player];
      const pct = (hp / match.rules.startHealth) * 100;
      this.text(`name${player}`, name(match, player));
      this.text(`hp${player}`, String(hp));
      const number = this.el[`hp${player}`]!;
      number.dataset.littleData = JSON.stringify({ health: hp });
      number.dataset.littleLabel = `${name(match, player)} health`;
      this.el[`fill${player}`]!.style.width = `${pct}%`;
      this.el[`plate${player}`]!.classList.toggle("active", match.shooter === player && match.phase !== "results");
      this.el[`plate${player}`]!.classList.toggle("low", pct <= 30);
    }
    this.text("round", `Round ${match.round} of ${match.rules.maxRounds}`);
    this.el.round!.dataset.littleData = JSON.stringify({
      round: match.round,
      shooter: name(match, match.shooter),
    });
  }

  private updateHandoff(match: Match): void {
    const firstTurn = match.round === 1 && match.shooter === 0;
    this.text("handTitle", firstTurn ? "Grab the remote" : "Pass the remote");
    this.text("handTo", firstTurn ? "you're up," : "to");
    this.text("handName", name(match, match.shooter));
    this.text("handOther", name(match, match.target));
    this.text("handHp0", `${name(match, 0)}: ${match.health[0]}`);
    this.text("handHp1", `${name(match, 1)}: ${match.health[1]}`);
    this.text("handRound", `Round ${match.round}`);
  }

  private updateAim(match: Match): void {
    const human = match.isHuman(match.shooter);
    const left = match.timeLeft;
    const seconds = Math.ceil(left);
    this.text("clock", String(seconds));
    this.el.watch!.style.setProperty("--left", String(left / match.rules.aimSec));
    this.el.watch!.classList.toggle("urgent", left <= 3);

    const bar = match.bar;
    const damage = damageFor(bar, match.rules);
    this.el.meter!.style.setProperty("--fill", bar.toFixed(3));
    this.el.meter!.dataset.heat = bar > 0.75 ? "hot" : bar > 0.4 ? "warm" : "cold";
    this.text("percent", `${Math.round(bar * 100)}%`);
    this.el.meter!.dataset.damage = String(damage);
    this.el.holler!.classList.toggle("watching", !human);

    const prompt = human
      ? "Press OK to shoot, or it fires when the meter fills"
      : this.tracking
        ? "The dummy's taking aim. Step left or right, or crouch to duck!"
        : "The dummy's taking aim. Move left and right, or press down to duck!";
    if (prompt !== this.lastPrompt) {
      this.lastPrompt = prompt;
      this.text("prompt", prompt);
    }
    this.text("ribbon", human ? `${name(match, match.shooter)}: Aim and shoot` : "Dodge!");
    this.el.ribbon!.dataset.littleData = JSON.stringify({ phase: "aiming", shooter: name(match, match.shooter) });
    this.el.bannerText!.textContent = human ? `${name(match, match.shooter)}'s shot` : "Incoming!";
    this.el.banner!.classList.toggle("show", match.phaseTime < 1.1);

    // The reticle sits at the aim point and is sized in world units, so it's exact.
    const s = planeToScreen(match.aim);
    const on = reticleHits(match.aim, match.reticle, match.targetX, match.bodyHeight);
    this.placeReticle(s.x, s.y);
    this.reticle.style.width = `${((match.reticle * 2) / PLANE.width) * 100}%`;
    this.reticle.classList.toggle("on-target", on);
    // Teaches the weak spots: the reticle names what it would hit.
    const zone = on && human ? hitZone(nearestPointOnBody(match.aim, match.targetX, match.bodyHeight), match.targetX, match.bodyHeight) : "body";
    this.text("reticleZone", zone === "head" ? "Headshot!" : zone === "nuts" ? "Nut shot!" : "");
  }

  private updateImpact(match: Match): void {
    const shot = match.shot!;
    this.el.sign!.classList.toggle("hit", shot.hit);
    this.text("signBig", shot.hit ? `-${shot.damage}` : "Missed!");
    this.text("signSmall", shot.hit ? `${name(match, shot.target)} is down!` : `${name(match, shot.target)} lives on`);
    this.text("stamp", shot.zone === "head" ? "Headshot!" : shot.zone === "nuts" ? "Nut shot!" : shot.xray ? "Rib shot!" : "");
  }

  private updateResults(match: Match, winner: Winner): void {
    this.text("resultTitle", winner === "draw" ? "Dead Heat" : `${name(match, winner)} ${match.mode === 1 && winner === 0 ? "win" : "wins"}!`);
    this.text(
      "resultSub",
      winner === "draw"
        ? "Both duellists down. The town needs a new sheriff."
        : `${name(match, winner === 0 ? 1 : 0)} is seeing stars.`,
    );
    this.text("resultHits", `Shots landed ${match.shotsLanded[0]} : ${match.shotsLanded[1]}`);
    this.el.resultTitle!.dataset.littleData = JSON.stringify({
      result: winner === "draw" ? "draw" : name(match, winner),
      health: match.health,
    });
  }
}

const RETICLE_SVG = `
<svg viewBox="0 0 100 100" aria-hidden="true">
  <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" stroke-width="3.2"/>
  <circle cx="50" cy="50" r="46" fill="currentColor" opacity="0.12"/>
  <path d="M50 0v15M50 85v15M0 50h15M85 50h15" stroke="currentColor" stroke-width="4"/>
  <circle cx="50" cy="50" r="2.4" fill="currentColor"/>
</svg>`;

const TEMPLATE = `
<div class="bars"><i></i><i></i></div>

<div class="reticle" data-el="reticle">${RETICLE_SVG}<span class="reticle-zone" data-el="reticleZone"></span></div>
<div class="rays" aria-hidden="true"></div>
<div class="xray" aria-hidden="true"></div>
<div class="stamp" data-el="stamp"></div>
<div class="tutorial">
  <div class="tut-step" data-el="tutStep"></div>
  <div class="tut-title" data-el="tutTitle"></div>
  <div class="tut-note" data-el="tutNote"></div>
  <div class="tut-skip">Press Back to skip</div>
</div>

<div class="rush">
  <div class="rush-hearts" data-el="rushHearts" data-little="readout" data-little-label="Lives">
    ${HEART_SVG.repeat(RUSH.hearts)}
  </div>
  <div class="rush-wave" data-el="rushWave" data-little="readout" data-little-label="Wave"></div>
  <div class="rush-ammo" data-el="rushAmmo">${"<i></i>".repeat(RUSH.ammo)}</div>
  <div class="rush-scorebox" data-el="rushScoreBox">
    <small>Score</small>
    <div class="rush-score" data-el="rushScore" data-little="readout" data-little-label="Score"></div>
    <div class="rush-multiplier" data-el="rushMultiplier"></div>
  </div>
  <div class="rush-deadeye"><small>Dead-eye</small><div><i data-el="rushDeadEyeFill"></i></div></div>
  <div class="rush-note" data-el="rushNote" hidden></div>
  <div class="rush-combo" data-el="rushCombo"></div>
  <div class="rush-callout" data-el="rushCallout"></div>
  <div class="rush-boss" data-el="rushBoss" data-little="readout" data-little-label="Big Gat's health" hidden>
    <b>Big Gat</b>
    <div class="rush-boss-track" data-el="rushBossTrack"><i class="lag" data-el="rushBossLag"></i><i class="fill" data-el="rushBossFill"></i></div>
  </div>
  <div class="rush-help" data-el="rushHelp"></div>
  <div class="rush-word" data-el="rushWord"></div>
  <svg class="rush-alert strike" data-el="rushStrike0" viewBox="-10 -10 120 220" hidden aria-hidden="true"><path d="M20 4h60L64 132H36z"/><circle cx="50" cy="170" r="25"/></svg>
  <svg class="rush-alert strike" data-el="rushStrike1" viewBox="-10 -10 120 220" hidden aria-hidden="true"><path d="M20 4h60L64 132H36z"/><circle cx="50" cy="170" r="25"/></svg>
  <svg class="rush-alert strike" data-el="rushStrike2" viewBox="-10 -10 120 220" hidden aria-hidden="true"><path d="M20 4h60L64 132H36z"/><circle cx="50" cy="170" r="25"/></svg>
  <svg class="rush-alert" data-el="rushAlert" viewBox="-10 -10 120 220" hidden aria-hidden="true"><path d="M20 4h60L64 132H36z"/><circle cx="50" cy="170" r="25"/></svg>
</div>
<div class="rush-floats" data-el="rushFloats"></div>
<div class="rush-tally" data-el="rushTally" data-little="readout" data-little-label="Wave report"></div>
<div class="rush-hurt" data-el="rushHurt" aria-hidden="true"></div>
<svg class="rush-mark" data-el="rushMark0" viewBox="-50 -50 100 100" hidden aria-hidden="true">${MARK_SVG}</svg>
<svg class="rush-mark" data-el="rushMark1" viewBox="-50 -50 100 100" hidden aria-hidden="true">${MARK_SVG}</svg>
<div class="rush-whiskey" data-el="rushWhiskey" hidden>${HEART_SVG}</div>
<div class="tut-mark" data-el="tutMark"></div>

<div class="title-seq" aria-hidden="true">
  <div class="title-sun"></div>
  <div class="title-logo" data-el="titleLogo"></div>
  <svg class="title-land" viewBox="0 0 1920 520" preserveAspectRatio="none">
    <path d="M0 200 L150 190 L190 120 L340 112 L372 190 L560 215 L700 240 L1000 250 L1210 230 L1320 170 L1350 96 L1560 88 L1600 165 L1760 180 L1920 165 V520 H0Z" class="far"/>
    <path d="M0 330 L220 318 V262 H262 V236 H330 V262 H372 V318 L470 322 V280 H560 V330 L800 348 L1120 350 L1280 332 V286 H1340 V252 H1420 V286 H1480 V330 L1650 322 V300 H1672 V258 H1690 V296 H1712 V276 H1730 V322 L1920 310 V520 H0Z" class="near"/>
  </svg>
  <div class="title-bar top"></div>
  <div class="title-bar bottom"></div>
</div>
<div class="impact-flash" data-el="impact"></div>
<div class="shot-flash" data-el="shotFlash"></div>
<div class="pointer" data-el="pointer" hidden></div>

<div class="loading" data-el="loading">Riding into town...</div>

<div class="plate p0" data-el="plate0">
  <div class="star" aria-hidden="true">★</div>
  <div class="plate-body">
    <div class="plate-top"><span class="pname" data-el="name0"></span><strong data-el="hp0" data-little="readout"></strong></div>
    <div class="hpbar"><i data-el="fill0"></i></div>
  </div>
</div>
<div class="plate p1" data-el="plate1">
  <div class="plate-body">
    <div class="plate-top"><strong data-el="hp1" data-little="readout"></strong><span class="pname" data-el="name1"></span></div>
    <div class="hpbar"><i data-el="fill1"></i></div>
  </div>
  <div class="star" aria-hidden="true">★</div>
</div>

<div class="centre">
  <div class="watch" data-el="watch"><div class="dial"><span data-el="clock"></span></div></div>
  <div class="round" data-el="round" data-little="readout" data-little-label="Round"></div>
</div>
<div class="ribbon" data-el="ribbon" data-little="readout" data-little-label="Turn"></div>

<div class="holler" data-el="holler">
  <div class="meter" data-el="meter"><div class="holler-percent" data-el="percent">0%</div></div>
  <div class="holler-note">
    <svg class="holler-remote" viewBox="0 0 34 70" aria-hidden="true">
      <rect x="4" y="2" width="26" height="66" rx="12"/>
      <circle cx="17" cy="19" r="8" class="press"/>
      <circle cx="17" cy="41" r="3.4"/><circle cx="17" cy="53" r="3.4"/>
    </svg>
    <span data-el="prompt"></span>
  </div>
</div>

<div class="banner" data-el="banner"><span data-el="bannerText"></span></div>
<div class="caption" data-el="caption"></div>

<div class="sign" data-el="sign">
  <div class="sign-big" data-el="signBig"></div>
  <div class="sign-small" data-el="signSmall"></div>
</div>

<div class="intro">
  <div class="intro-solo" data-el="introSolo"></div>
  <div class="intro-versus">
    <div class="intro-slash"></div>
    <div class="intro-name top" data-el="introA"></div>
    <div class="intro-name bottom" data-el="introB"></div>
    <div class="intro-vs">VS</div>
  </div>
  <div class="intro-skip">Press Select to skip</div>
</div>

<section class="screen camcheck" data-screen="camera" data-el="camCheck" data-little="readout" data-little-label="Camera check">
  <div class="cam-head">
    <svg class="cam-icon" viewBox="0 0 64 64" aria-hidden="true"><rect x="8" y="18" width="48" height="32" rx="6"/><circle cx="32" cy="34" r="10"/><circle cx="32" cy="34" r="4" class="lens"/><rect x="24" y="10" width="16" height="8" rx="2"/></svg>
    <div class="cam-kicker">Camera check</div>
    <h2 class="cam-title" data-el="camTitle"></h2>
    <p class="cam-note" data-el="camNote"></p>
  </div>
  <div class="cam-ring" data-el="camRing" aria-hidden="true"><i></i></div>
  <div class="cam-hand" data-el="camHand" hidden aria-hidden="true"></div>
  <div class="cam-skip" data-el="camSkip"></div>
</section>

<section class="screen menu" data-screen="menu">
  <div class="menu-logo" data-el="logo"></div>
  <div class="cylinder" data-el="cylinder"></div>
  <div class="menu-banner" data-el="menuBanner"></div>
  <div class="coin-count" aria-label="Coins"><i></i><span data-el="menuCoins" data-little="readout" data-little-label="Coins"></span></div>
</section>

<section class="screen shop" data-screen="shop" data-little="region" data-little-label="Outfits">
  <header><h2>Outfits</h2><div class="coin-count"><i></i><span data-el="shopCoins" data-little="readout" data-little-label="Coins"></span></div></header>
  <div class="shop-arrow left" aria-hidden="true"></div>
  <div class="shop-arrow right" aria-hidden="true"></div>
  <div class="shop-info">
    <h3 data-el="shopName" data-little="readout" data-little-label="Gun"></h3>
    <p data-el="shopBlurb"></p>
    <p class="shop-stats" data-el="shopStats"></p>
    <em data-el="shopPrice" data-little="readout" data-little-label="Price"></em>
    <div class="shop-dots" data-el="shopCards"></div>
    <p class="shop-hint" data-el="shopHint"></p>
  </div>
</section>

<section class="screen settings" data-screen="settings" data-little="region" data-little-label="Settings">
  <div class="settings-panel">
    <h2>Settings</h2>
    <div class="settings-row" data-el="settingsAim" data-little="readout" data-little-label="Auto aim"><span>Auto aim</span><div class="settings-choice"><i class="left"></i><b data-el="settingsAimValue"></b><i class="right"></i></div></div>
    <div class="settings-row" data-el="settingsDev" data-little="readout" data-little-label="Dev mode"><span>Dev mode</span><b data-el="settingsDevValue"></b></div>
    <div class="settings-row" data-el="settingsBack"><span>Back</span></div>
    <p class="settings-hint" data-el="settingsHint"></p>
  </div>
</section>

<section class="screen paper" data-screen="handoff">
  <div class="poster">
    <div class="poster-kicker" data-el="handRound"></div>
    <h2 data-el="handTitle"></h2>
    <p class="poster-name"><span data-el="handTo"></span> <b data-el="handName"></b></p>
    <div class="remote-art" aria-hidden="true"><i></i><i></i><i></i><b></b></div>
    <p class="poster-note">Aim, then press OK to shoot. <span data-el="handOther"></span> dodges with A and D.</p>
    <div class="poster-hp"><span data-el="handHp0"></span><span data-el="handHp1"></span></div>
    <p class="poster-press">Click or press Select when you've got it</p>
  </div>
</section>

<section class="screen results paper" data-screen="results">
  <div class="poster">
    <div class="poster-kicker">Showdown over</div>
    <h2 data-el="resultTitle" data-little="readout" data-little-label="Result"></h2>
    <p class="poster-note" data-el="resultSub"></p>
    <p class="poster-stat" data-el="resultHits"></p>
    <div class="poster-buttons">
      <button class="wood" data-el="rematch">Rematch</button>
      <button class="wood quiet" data-el="quitResults" data-little="control" data-little-action="quit" data-little-label="Quit">Quit</button>
    </div>
  </div>
</section>

<section class="screen results paper" data-screen="rushEnd">
  <div class="poster">
    <div class="poster-kicker">Rush over</div>
    <h2 data-el="rushTitle" data-little="readout" data-little-label="Result"></h2>
    <p class="poster-stat" data-el="rushStat"></p>
    <p class="poster-stat" data-el="rushAccuracy"></p>
    <p class="poster-stat rush-coins" data-el="rushCoins" data-little="readout" data-little-label="Coins earned"></p>
    <b class="rush-grade" data-el="rushFinalGrade" data-little="readout" data-little-label="Grade"></b>
    <div class="rush-entry" data-el="rushEntry" hidden></div>
    <ol class="rush-scores" data-el="rushScores" data-little="readout" data-little-label="High scores"></ol>
    <p class="poster-note" data-el="rushEndNote">Press OK to go back to town.</p>
  </div>
</section>

<section class="screen paper" data-screen="pause">
  <div class="poster">
    <h2>Hold your fire</h2>
    <div class="poster-buttons">
      <button class="wood" data-el="resume">Keep playing</button>
      <button class="wood quiet" data-el="quitPause">Quit to menu</button>
    </div>
  </div>
</section>
`;

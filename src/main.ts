import { loadSettings, nextAimLevel, saveSettings, type Settings } from "./game/settings";
import { ShakeDetector } from "./input/shake";
import { GUNS, gunById } from "./game/guns";
import { buyGun, coinsForRun, earn, equipGun, loadWallet, ownsGun, saveWallet, toggleDev, type Wallet } from "./game/wallet";
import type { Intro } from "../lookdev/intro";
import { BOSS } from "./game/boss";
import { InitialsEntry, addToTable, loadScores, placeInTable, saveScores, type HighScore } from "./game/arcade";
import "@fontsource/rye/400.css";
import "@fontsource/bitter/700.css";
import "@fontsource/bitter/800.css";
import "./style.css";

import { connect } from "@kabletv/little-sdk";
import { createMotionSession } from "@kabletv/little-motion";
import { Music } from "./audio/music";
import { Sfx } from "./audio/sfx";
import { Match, type MatchEvent, type Mode, type PlayerInput } from "./game/match";
import { RUSH, Rush, aimAtDepth, projectToScreen, rushCamStage, type RushEvent } from "./game/rush";
import { DEFAULT_RULES, KILLCAM, introStage, killCamFor, type Rules, type Vec2 } from "./game/rules";
import { Tutorial, nearNuts, nutsPoint } from "./game/tutorial";
import { CameraCheck, type CameraReading } from "./game/cameraCheck";
import { Controls, DodgingPlayer, Dummy, SimulatedRemote, keyName } from "./input/inputs";
import { BodyStance, type Keypoint } from "./input/bodyStance";
import { LeanMove, readLean } from "./input/leanMove";
import { MotionAim, type CursorControl } from "./input/motionAim";
import { Scene, type View } from "./render/scene";
import { createDevPanel } from "./ui/devPanel";
import { CameraPanel, type CameraGrantLike } from "./ui/cameraPanel";
import { Hud, type Screen } from "./ui/hud";

const STEP = 1 / 60;
/**
 * The picture is drawn smaller and blown up with hard-edged pixels, for a very light crunch, while the HUD
 * stays sharp on top. It's half of 1080p, so every pixel is even.
 * Add ?pixels=960 to the address to try another width.
 */
const RENDER_WIDTH = Number(new URLSearchParams(location.search).get("pixels")) || 960;
const RENDER_HEIGHT = Math.round((RENDER_WIDTH * 9) / 16);
/** Ignore presses just after a hand-off opens, so spamming can't skip the screen. */
const HANDOFF_GUARD_SEC = 0.7;

const root = document.getElementById("root")!;
// The stage holds the game. It shrinks to the left when the camera preview is showing.
const stage = document.createElement("div");
stage.className = "stage";
root.appendChild(stage);
const canvas = document.createElement("canvas");
canvas.className = "view";
stage.appendChild(canvas);

canvas.width = RENDER_WIDTH;
canvas.height = RENDER_HEIGHT;
const scene = new Scene(canvas);
const sfx = new Sfx();
const music = new Music();
const controls = new Controls(stage);
const rules: Rules = { ...DEFAULT_RULES };

let screen: Screen = "menu";
let match: Match | null = null;
/** How long the end screen ignores OK, so mashing the fire button doesn't skip it. */
const END_GUARD_SEC = 0.9;
/** When the wave tally's grade comes down, to match its sound. */
const TALLY_GRADE_SEC = 1.15;
let scoreTable: HighScore[] = [];
let scoreEntry: InitialsEntry | null = null;
let rideStep = 0;
let ricochetTipAt = 0;
/** Coins and guns, kept between sessions. */
let wallet: Wallet = loadWallet(safeStorage());
/** Which card's picked in the outfits screen, and until when the arrows have the say over your arm. */
let shopSelected = 0;
let shopArrowsUntil = 0;
/** Arrow presses waiting to be acted on. A remote's tap can be shorter than a frame, so they're counted as they come. */
let shopPresses = 0;
/** The player's settings, which row's picked on that screen, and arrow presses waiting to be acted on. */
let settings: Settings = loadSettings(safeStorage());
let settingsSelected = 0;
let settingsRowPresses = 0;
let settingsValuePresses = 0;
/** The storyboard before the first fight, while it's on, and whether it's been seen this session. */
let opening: Intro | null = null;
let openingT = 0;
let openingSeen = false;
let endGuard = 0;
const arrowsHeld = new Set<string>();
let paused = false;
let hostPaused = false;
let lastMode: Mode = 1;
/** After a start sign is shot, the match begins once it has finished toppling. */
let startAt: { time: number; mode: Mode | "rush" } | null = null;
let clock = 0;
const MENU_START_DELAY_SEC = 1.6;
/** Long enough to see the QUIT sign get shot before the game closes. */
const QUIT_DELAY_SEC = 1.7;
const OUTFITS_DELAY_SEC = 0.7;
const OPENING_MUSIC_DUCK_SEC = 12;
/** How long an arrow press keeps your arm from changing what's picked. */
const SHOP_ARROWS_HOLD_SEC = 2;
/** How close to the edge of the screen counts as pointing off to one side, and how often that moves along. */
const SHOP_POINT_EDGE = 0.2;
const SHOP_POINT_REPEAT_SEC = 0.85;
/** How many rows there are on the settings screen, where your arm goes from one to the next, and where the gun rests. */
const SETTINGS_ROWS = 3;
const SETTINGS_ROW_SPLITS = [0.5, 0.62] as const;
const SETTINGS_AIM = { x: 0.5, y: 0.08 };
/** The shortest gap between reminders that only his heart can be hurt. */
const RICOCHET_TIP_SEC = 6;
let quitAt = 0;
let shopAt = 0;
let settingsAt = 0;
/** Either hand will do, going either way. */
const shakers = [new ShakeDetector(), new ShakeDetector(), new ShakeDetector(), new ShakeDetector()] as const;

const remote = new SimulatedRemote(controls);
/** Whether this is running on the TV, rather than a browser with a mouse. */
const ON_TV = /Android/.test(navigator.userAgent);
const motion = new MotionAim();
// The camera aims. The moment it loses you, the mouse and arrows take over.
remote.aimOverride = () => (motion.live ? motion.position : null);
let trackingState = "off";
let trackingReason = "";
const leanMove = new LeanMove();
/** Which way a lean moves on screen. Flip this if leaning right moves left. */
const LEAN_DIRECTION = 1;
let lastLean: number | null = null;
let rush: Rush | null = null;
let previousCamStage = "";
/** Points earned on a bullet cam's kill wait for the camera to come back, so they can be seen. */
let waitingScores: Extract<RushEvent, { type: "scored" }>[] = [];
let reloadKey = false;
const stance = new BodyStance();
/** Which way a step moves on screen. Flip this if stepping right moves left. */
const STEP_DIRECTION = -1;
/** How long the skeleton can go quiet before we stop trusting the last reading. */
const POSE_STALE_MS = 500;
let lastPoseAt = 0;
let autoStarted = false;
let tutorial: Tutorial | null = null;
/** Seconds since the tutorial's lizard went down, or -1 while he's still standing. */
let tutorialDoneFor = -1;
/** How long "nice shot" hangs after the x-ray, before the title. */
const TUTORIAL_OUTRO_SEC = 0.8;
/** Everyone starts on the revolver, so that's what the tutorial teaches on. */
const TUTORIAL_GUN = "revolver";
/** The camera check at launch, while it's on. */
let cameraCheck: CameraCheck | null = null;
/** When the title sequence cuts to the menu. */
let titleEndsAt = 0;
const TITLE_SEC = 4.1;
// v3: the tutorial moved from the duel onto a lizard, so everyone sees it once more.
const TUTORIAL_SEEN_KEY = "ragebait.tutorial.v3";
let loaded = false;
const dummy = new Dummy(() => match?.targetX ?? 0);
const dodgerTwoPlayer = new DodgingPlayer(controls, false);
const dodgerSolo = new DodgingPlayer(controls, true);
dodgerSolo.autoDodge = false;

function inputsFor(m: Match): { shooter: PlayerInput; target: PlayerInput } {
  return {
    shooter: m.isHuman(m.shooter) ? remote : dummy,
    target: !m.isHuman(m.target) ? dummy : m.mode === 2 ? dodgerTwoPlayer : dodgerSolo,
  };
}

/** Turns tracking on as the game opens, on a TV. The simulator aims with input unless asked, with ?track. */
function tryAutoStartTracking(): void {
  const query = new URLSearchParams(location.search);
  if (autoStarted || !loaded || !(ON_TV || query.has("track")) || !app.can("sense.motion") || query.has("notrack")) return;
  autoStarted = true;
  startTracking();
}

function tutorialSeen(): boolean {
  try {
    return localStorage.getItem(TUTORIAL_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

/** Where the camera's at, for the camera check: missing or off, on and searching, or following your arm. */
function cameraReading(): CameraReading {
  if (!motion.on) return "none";
  return motion.live ? "live" : "looking";
}

/** At launch: says the game needs a camera, and waits until it's found you and you've pointed at the ring. */
function startCameraCheck(): void {
  cameraCheck = new CameraCheck();
  screen = "camera";
  controls.consumeConfirm();
  syncTools();
}

/** On to the tutorial the first time, and straight to the title after that. */
function finishCameraCheck(): void {
  cameraCheck = null;
  hud.updateCameraCheck("none", 0, null);
  if (tutorialSeen()) startTitle();
  else startTutorial();
}

function cameraCheckFrame(dt: number): void {
  const check = cameraCheck;
  if (!check) return;
  // OK always lets you carry on, with the remote.
  if (controls.consumeConfirm()) {
    unlockAudio();
    finishCameraCheck();
    return;
  }
  const before = check.state;
  const aim = motion.live ? motion.position : null;
  const finished = check.update(dt, cameraReading(), aim);
  if (check.state === "done" && before !== "done") sfx.bell();
  hud.updateCameraCheck(check.state, check.held, aim);
  if (finished) finishCameraCheck();
}

/** Where the practice lizard's nuts are on screen, if he's still standing. */
function tutorialNuts(): Vec2 | null {
  const lizard = rush?.practice ? rush.enemies[0] : undefined;
  if (!rush || !lizard) return null;
  return projectToScreen(lizard.x, nutsPoint(lizard.x).y, lizard.z, rush.cameraX, rush.cameraY);
}

/** One lizard standing in the street, and the gun held back until the last step. */
function startTutorial(): void {
  startRush({ practice: true });
  tutorial = new Tutorial();
  tutorialDoneFor = -1;
  // Starts off to one side, so the first step really does need some aiming.
  remote.aimFrom({ x: 0.22, y: 0.4 });
}

function finishTutorial(): void {
  tutorial = null;
  rush = null;
  match = null;
  // Back to the gun you picked, for the menu and the run.
  scene.setGun(wallet.equipped);
  hud.updateTutorial(null, false);
  try {
    localStorage.setItem(TUTORIAL_SEEN_KEY, "1");
  } catch {
    // Private windows can refuse storage. It only means the tutorial runs again next time.
  }
  startTitle();
}

function startTitle(): void {
  screen = "title";
  titleEndsAt = clock + TITLE_SEC;
  hud.showTitle(true);
  sfx.stab(false);
  syncTools();
}

function finishTitle(): void {
  screen = "menu";
  hud.showTitle(false);
  hud.impactFlash();
  sfx.stab(true);
  syncTools();
}

function tutorialFrame(dt: number): void {
  if (!tutorial || !rush) return;
  const lizard = rush.enemies[0];
  if (lizard && !rush.cam) {
    // Where the reticle lands on his plane, to tell whether it's over his nuts.
    const there = aimAtDepth(rush.aim, -lizard.z, rush.cameraX, rush.cameraY);
    tutorial.update(dt, rush.onTarget, nearNuts(there, lizard.x));
  }
  // He's gone and the x-ray's over: a moment to take it in, then the title.
  const gone = !lizard && !rush.cam;
  if (gone) tutorialDoneFor = Math.max(0, tutorialDoneFor) + dt;
  hud.updateTutorial(tutorial, motion.live, tutorialNuts(), !lizard);
  if (tutorialDoneFor >= TUTORIAL_OUTRO_SEC) finishTutorial();
}

function startMatch(mode: Mode): void {
  rush = null;
  tutorial = null;
  cameraCheck = null;
  hud.updateTutorial(null, false);
  hud.showTitle(false);
  lastMode = mode;
  match = new Match(mode, rules);
  screen = "match";
  paused = false;
  startAt = null;
  unlockAudio();
  controls.consumeConfirm();
  remote.reset();
  syncTools();
}

/** Goons rush you and throw things, and then there's a boss. Or, for the tutorial, one lizard who doesn't. */
function startRush(options: { practice?: boolean } = {}): void {
  tutorial = null;
  cameraCheck = null;
  hud.updateTutorial(null, false);
  hud.showTitle(false);
  match = null;
  // The tutorial always teaches on the revolver, whatever's equipped. A real run takes the gun you picked.
  const gunId = options.practice ? TUTORIAL_GUN : wallet.equipped;
  scene.setGun(gunId);
  rush = new Rush({ seed: Math.floor(Math.random() * 1e6), gun: gunById(gunId), aimLevel: settings.aimLevel, practice: options.practice });
  screen = "rush";
  paused = false;
  startAt = null;
  previousCamStage = "";
  waitingScores = [];
  unlockAudio();
  controls.consumeConfirm();
  remote.reset();
  scene.resetRush();
  syncTools();
}

/** Plays the storyboard, once a session, then the fight. It's built while the game loads, so this is instant. */
function startOpening(): void {
  if (openingSeen || !opening) {
    startRush();
    return;
  }
  openingSeen = true;
  screen = "opening";
  startAt = null;
  unlockAudio();
  controls.consumeConfirm();
  syncTools();
  music.duck(0.2, OPENING_MUSIC_DUCK_SEC);
  opening.show(true);
  openingT = 0;
}

function finishOpening(): void {
  opening?.dispose();
  opening = null;
  startRush();
}

/** Prints every panel of the storyboard while the loading screen's up: about 6 seconds on the TV, once. */
async function bakeOpening(): Promise<void> {
  const bakingFrom = performance.now();
  try {
    const built = await scene.makeOpening(stage);
    built.show(false);
    built.onCue = (cue) => {
      if (cue === "blast") sfx.boom();
      else if (cue === "impact") sfx.stab(true);
      else if (cue === "whip") sfx.miss();
      else sfx.barrelLand();
    };
    opening = built;
  } catch (error) {
    console.warn("[ragebait] the opening didn't load", error);
  }
  scene.endOpening();
  console.info(`[ragebait] opening baked in ${Math.round(performance.now() - bakingFrom)} ms`);
}

function openShop(): void {
  screen = "shop";
  startAt = null;
  shopSelected = Math.max(0, GUNS.findIndex((g) => g.id === wallet.equipped));
  shopArrowsUntil = clock + SHOP_ARROWS_HOLD_SEC;
  controls.consumeConfirm();
  syncTools();
}

function closeShop(): void {
  scene.setGun(wallet.equipped);
  screen = "menu";
  scene.resetMenu();
  controls.consumeConfirm();
  syncTools();
}

function openSettings(): void {
  screen = "settings";
  startAt = null;
  settingsSelected = 0;
  settingsRowPresses = 0;
  settingsValuePresses = 0;
  controls.consumeConfirm();
  syncTools();
}

function closeSettings(): void {
  screen = "menu";
  scene.resetMenu();
  controls.consumeConfirm();
  syncTools();
}

function setAimLevel(direction: number): void {
  settings = { ...settings, aimLevel: nextAimLevel(settings.aimLevel, direction) };
  saveSettings(safeStorage(), settings);
  sfx.cock();
}

/** The settings screen. Up and down pick a row, or your arm does. Left and right change it, and so does OK. */
function settingsFrame(dt: number): void {
  if (settingsRowPresses !== 0) {
    settingsSelected = (settingsSelected + settingsRowPresses + SETTINGS_ROWS * 4) % SETTINGS_ROWS;
    settingsRowPresses = 0;
    shopArrowsUntil = clock + SHOP_ARROWS_HOLD_SEC;
    sfx.tick();
  } else if (clock >= shopArrowsUntil && (motion.live || controls.mouseUsed)) {
    const y = remote.aim().y;
    const row = y < SETTINGS_ROW_SPLITS[0] ? 0 : y < SETTINGS_ROW_SPLITS[1] ? 1 : 2;
    if (row !== settingsSelected) {
      settingsSelected = row;
      sfx.tick();
    }
  }
  if (settingsValuePresses !== 0) {
    // Left and right only mean something on the row with a choice of values.
    if (settingsSelected === 0) setAimLevel(Math.sign(settingsValuePresses));
    settingsValuePresses = 0;
    shopArrowsUntil = clock + SHOP_ARROWS_HOLD_SEC;
  }
  // The street carries on behind, with nobody aimed at.
  scene.menuUpdate(dt, SETTINGS_AIM);
  remote.reset();
  hud.updateSettings(settings.aimLevel, wallet.dev === true, settingsSelected);
  if (!controls.consumeConfirm()) return;
  unlockAudio();
  if (settingsSelected === 0) {
    setAimLevel(1);
  } else if (settingsSelected === 1) {
    setWallet(toggleDev(wallet));
    sfx.cock();
  } else {
    closeSettings();
  }
}

function setWallet(next: Wallet): void {
  wallet = next;
  saveWallet(safeStorage(), wallet);
  hud.showCoins(wallet.coins, wallet.dev);
  scene.setGun(wallet.equipped);
}

/** Moves along the row of guns, wrapping round at the ends. */
function shopStep(direction: number): void {
  const count = GUNS.length + 1;
  shopSelected = (shopSelected + direction + count) % count;
  scene.turnShop(direction);
  sfx.tick();
}

/** The outfits screen. Left and right move along, or point off to either side, and OK buys or straps on. */
function shopFrame(): void {
  if (shopPresses !== 0) {
    for (; shopPresses !== 0; shopPresses -= Math.sign(shopPresses)) shopStep(Math.sign(shopPresses));
    shopArrowsUntil = clock + SHOP_ARROWS_HOLD_SEC;
  } else if (clock >= shopArrowsUntil && (motion.live || controls.mouseUsed)) {
    // Pointing off to one side moves along, and keeps moving while you hold it there.
    const x = remote.aim().x;
    if (x < SHOP_POINT_EDGE || x > 1 - SHOP_POINT_EDGE) {
      shopStep(x > 0.5 ? 1 : -1);
      shopArrowsUntil = clock + SHOP_POINT_REPEAT_SEC;
    }
  }
  const gun = GUNS[shopSelected];
  // You see it turning before you pay for it.
  if (gun) scene.setGun(gun.id);
  remote.reset();
  hud.updateShop(wallet, shopSelected);
  if (!controls.consumeConfirm()) return;
  unlockAudio();
  if (!gun) {
    closeShop();
  } else if (ownsGun(wallet, gun.id)) {
    setWallet(equipGun(wallet, gun.id));
    sfx.cock();
  } else {
    const bought = buyGun(wallet, gun.id);
    if (bought) {
      setWallet(bought);
      sfx.fanfare();
    } else {
      sfx.dryFire();
    }
  }
}

function handleRush(event: RushEvent): void {
  scene.onRush(event, rush?.railX ?? 0, rush?.railZ ?? 0);
  switch (event.type) {
    case "scored":
      if (rush?.cam) waitingScores.push(event);
      else showScore(event);
      break;
    case "travel":
      hud.rushBanner("To the bank!");
      break;
    case "lastKill":
      music.duck(0.35, RUSH.lastKillSlowSec);
      break;
    case "strikeWindup":
      sfx.cock();
      break;
    case "cannonRollout":
      hud.rushCallout("They've got a cannon!");
      sfx.barricades(5, 0.45);
      break;
    case "cannonWarn":
      sfx.bell();
      break;
    case "cannonFired":
      sfx.boom();
      break;
    case "trampled":
      sfx.bodyThud();
      break;
    case "cannonDone":
      hud.rushCallout("Here they come!");
      break;
    case "arena":
      hud.rushBanner("End of the line!");
      sfx.barricades(8, 0.14);
      break;
    case "bossLanded":
      sfx.bossLand();
      hud.rushBanner("Big Gat!");
      break;
    case "challenge":
      sfx.roar();
      break;
    case "bossCharge":
      hud.rushBanner("He's spinning up!");
      sfx.spinUp(BOSS.chargeSec);
      break;
    case "bossFire":
      sfx.minigun(event.sec);
      break;
    case "bossBlocked":
      hud.rushCallout("Can't hurt him now!");
      sfx.ping();
      break;
    case "bossReveal":
      hud.rushCallout("Shoot the heart!");
      sfx.roar();
      break;
    case "bossRicochet":
      sfx.ping();
      // Says why, but not every shot.
      if (clock >= ricochetTipAt) {
        ricochetTipAt = clock + RICOCHET_TIP_SEC;
        hud.rushCallout("Only the heart can hurt him!");
      }
      break;
    case "bossHurt":
      sfx.heartHit();
      break;
    case "faceoff":
      sfx.stab(false);
      break;
    case "wave":
      hud.rushBanner(`Wave ${event.number}`);
      sfx.bell();
      break;
    case "cleared":
      hud.rushTally(event.report);
      sfx.tally(TALLY_GRADE_SEC);
      break;
    case "bossArrives":
      sfx.miss();
      break;
    case "shootTime":
      hud.rushBanner("Your turn!");
      break;
    case "dodgeTime":
      sfx.stab(false);
      break;
    case "word":
      sfx.spinUp(RUSH.warnSec);
      break;
    case "shot":
      if (event.killed?.cam) sfx.gunshot(1);
      else sfx.shot(event.killed !== null || event.bossHit || event.thrown !== null, event.killed !== null);
      music.duck(0.4, 0.35);
      break;
    case "ignited":
      sfx.ignite();
      sfx.scream();
      hud.rushCallout("On fire!");
      break;
    case "burnedDown":
      sfx.scream();
      break;
    case "fireBurst":
      sfx.fireBurst();
      break;
    case "barrelLanded":
      if (event.hard) sfx.barrelLand();
      break;
    case "barrel":
      sfx.boom();
      if (event.killed.length > 0) {
        hud.rushCallout(event.killed.length > 1 ? `${event.killed.length} in one blast!` : "Boom!");
      }
      break;
    case "hat":
      sfx.click();
      break;
    case "pierced":
      sfx.pierce(event.next !== null);
      if (event.next) hud.rushCallout("Clean through!");
      break;
    case "blocked":
      sfx.woodHit(false);
      break;
    case "shieldBroke":
      sfx.woodHit(true);
      hud.rushCallout("Shield's gone!");
      break;
    case "ducked":
      sfx.duckSquawk();
      hud.rushCallout("Ducked it!");
      break;
    case "wounded":
      sfx.click();
      break;
    case "combo":
      hud.rushCombo(event.combo, event.multiplier);
      sfx.bell();
      break;
    case "whiskey":
      hud.rushCallout("Whiskey! Shoot it!");
      break;
    case "healed":
      sfx.fanfare();
      break;
    case "goldenEscaped":
      hud.rushCallout("The gold got away!");
      break;
    case "empty":
      sfx.dryFire();
      break;
    case "reloading":
      sfx.cylinderOpen();
      sfx.shellsFall(event.bullets);
      break;
    case "bulletIn":
      sfx.bulletIn(event.loaded);
      break;
    case "reloadClosing":
      sfx.cylinderClose();
      break;
    case "deadEyeStart":
      sfx.gong();
      music.duck(0.2, 4);
      hud.rushCallout("Dead-eye!");
      break;
    case "threw":
    case "dodged":
      sfx.miss();
      break;
    case "smashed":
      sfx.glass();
      break;
    case "struck":
      sfx.hurt();
      hud.rushHurt();
      break;
    case "ended": {
      if (event.won) sfx.fanfare();
      else sfx.gong();
      startScoreEntry();
      const paid = rush ? coinsForRun(rush.score, event.won) : 0;
      setWallet(earn(wallet, paid));
      hud.rushCoins(paid, wallet.coins);
      break;
    }
  }
}

/** Puts up the end screen, and if the score made the board, asks for initials. */
function startScoreEntry(): void {
  if (!rush) return;
  endGuard = END_GUARD_SEC;
  scoreTable = loadScores(safeStorage());
  scoreEntry = placeInTable(scoreTable, rush.score) >= 0 ? new InitialsEntry() : null;
  hud.rushResults(rush.summary, scoreTable, scoreEntry, rush.score);
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** True on the frame an arrow goes down. */
function arrowPressed(code: string): boolean {
  const down = controls.isDown(code);
  const was = arrowsHeld.has(code);
  if (down) arrowsHeld.add(code);
  else arrowsHeld.delete(code);
  return down && !was;
}

/** The end screen: typing initials if they made the board, then OK to go back to town. */
function stepEndScreen(pressed: boolean, dt: number): void {
  if (!rush) return;
  endGuard = Math.max(0, endGuard - dt);
  const entry = scoreEntry;
  if (entry) {
    let changed = false;
    if (arrowPressed("ArrowUp")) { entry.change(1); changed = true; }
    if (arrowPressed("ArrowDown")) { entry.change(-1); changed = true; }
    if (arrowPressed("ArrowLeft")) { entry.move(-1); changed = true; }
    if (arrowPressed("ArrowRight")) { entry.move(1); changed = true; }
    if (pressed && endGuard <= 0) {
      changed = true;
      sfx.bulletIn(entry.cursor + 1);
      if (entry.confirm()) {
        scoreTable = addToTable(scoreTable, { name: entry.name, score: rush.score });
        saveScores(safeStorage(), scoreTable);
        scoreEntry = null;
        endGuard = END_GUARD_SEC;
      }
    }
    if (changed) hud.rushResults(rush.summary, scoreTable, scoreEntry, rush.score);
    return;
  }
  if (pressed && endGuard <= 0) quitToMenu();
}

function showScore(event: Extract<RushEvent, { type: "scored" }>): void {
  if (!rush) return;
  const at = projectToScreen(event.x, event.y, event.z, rush.cameraX, rush.cameraY);
  // Off screen, it still counts: it just comes from the nearest edge.
  hud.rushScore(
    { x: Math.min(0.94, Math.max(0.06, at?.x ?? 0.5)), y: Math.min(0.88, Math.max(0.2, at?.y ?? 0.5)) },
    event.points,
    event.label,
  );
  sfx.tick();
}

function rushFrame(dt: number): void {
  if (!rush) return;
  const pressed = controls.consumeConfirm();
  if (rush.over) {
    stepEndScreen(pressed, dt);
    if (!rush) return;
  } else {
    // A and D, S and the remote's arrows stand in for the camera, whenever they're pressed.
    // Shaking your hand reloads, on the camera.
    const left = motion.live ? motion.hands.left : null;
    const right = motion.live ? motion.hands.right : null;
    const heard = [
      shakers[0].update(left?.x ?? null, dt),
      shakers[1].update(left?.y ?? null, dt),
      shakers[2].update(right?.x ?? null, dt),
      shakers[3].update(right?.y ?? null, dt),
    ];
    // A shake reloads when you're out. Otherwise it pulls your aim free of whatever it's stuck to.
    const shaken = heard.includes(true);
    if (shaken && rush.ammo <= 0) reloadKey = true;
    const dodging = rush.phase === "bossDodge";
    const keys = (controls.isDown("KeyD") || (dodging && controls.isDown("ArrowRight")) ? 1 : 0)
      - (controls.isDown("KeyA") || (dodging && controls.isDown("ArrowLeft")) ? 1 : 0);
    const leaned = motion.live ? leanMove.update(lastLean, dt) * LEAN_DIRECTION : 0;
    // In the tutorial the gun's held back until the last step, which locks the aim on his nuts so the shot lands.
    const nuts = tutorial?.aimLocked ? tutorialNuts() : null;
    const holdFire = tutorial !== null && !tutorial.aimLocked;
    rush.step(dt, {
      aim: nuts ?? remote.aim(),
      // An arm or a remote can't be as exact as a mouse, so both get help landing on things.
      // Not in the tutorial, where it'd keep dragging you off his nuts and up to his head.
      assist: tutorial ? 0 : motion.live ? 1 : ON_TV ? 0.7 : 0,
      breakAim: shaken && rush.ammo > 0,
      fire: pressed && !holdFire,
      fireHeld: controls.isDown("Enter") || controls.mouseHeld,
      lean: keys !== 0 ? keys : leaned,
      duck: controls.isDown("KeyS") || (dodging && controls.isDown("ArrowDown")) || (stance.seen && stance.ducking),
      reload: reloadKey,
    });
    reloadKey = false;
    for (const event of rush.drainEvents()) handleRush(event);
    const stage = rush.cam ? rushCamStage(rush.cam.t).name : "";
    // The kill's points and its name come up over the x-ray, as the bullet goes in.
    if (stage === "xray" && rush.cam && rushCamStage(rush.cam.t).t >= KILLCAM.frameSec && waitingScores.length > 0) {
      for (const event of waitingScores) hud.rushScore({ x: 0.5, y: 0.3 }, event.points, event.label, { boost: 1.1, sec: 1.9 });
      waitingScores = [];
      sfx.tick();
    }
    if (stage === "xray" && previousCamStage !== "xray" && rush.cam) {
      const zone = rush.cam.zone === "body" ? "head" : rush.cam.zone;
      sfx.hit(0, 0.8, zone, KILLCAM.contactSec, rules.killCamSec);
    }
    previousCamStage = stage;
    if (!rush.cam && waitingScores.length > 0) {
      for (const event of waitingScores) showScore(event);
      waitingScores = [];
    }
  }
  // A footfall with each bounce of the ride.
  if (rush.phase === "travel") {
    rideStep -= dt;
    if (rideStep <= 0) {
      rideStep = Math.PI / 9.5;
      sfx.footstep();
    }
  }
  hud.showRushFaceoff(rush.phase === "faceoff" ? rush.faceoffT : null, "Big Gat");
  hud.updateRush(rush, motion.live);
}

function quitToMenu(): void {
  match = null;
  rush = null;
  screen = "menu";
  paused = false;
  startAt = null;
  scene.resetMenu();
  syncTools();
}

function unlockAudio(): void {
  sfx.unlock();
  music.start();
}

const hud = new Hud(stage, {
  start: startMatch,
  rematch: () => startMatch(lastMode),
  quit: quitToMenu,
  resume: () => {
    paused = false;
  },
  sound: () => {
    unlockAudio();
    sfx.click();
  },
});

// Little: the agent can see the HUD through data-little attributes and drive these tools.
const app = connect();
app.onEnter(() => {
  tryAutoStartTracking();
});

const camera = new CameraPanel(
  root,
  () => app.media.camera({ facing: "user" }) as Promise<CameraGrantLike>,
  () => app.can("media.camera"),
);

app.tool("start_rush", () => {
  startOpening();
  return { detail: "Started the fight", say: "Here they come." };
});
app.tool("open_outfits", () => {
  if (screen !== "menu") quitToMenu();
  openShop();
  return { detail: "The outfits screen is up", say: "Pick your iron." };
});
app.tool("open_settings", () => {
  if (screen !== "menu") quitToMenu();
  openSettings();
  return { detail: "The settings screen is up" };
});
app.tool("equip_gun", (args: { id?: string }) => {
  const id = args?.id ?? "";
  if (!ownsGun(wallet, id)) return { detail: `${gunById(id).name} isn't owned yet` };
  setWallet(equipGun(wallet, id));
  return { detail: `Holding the ${gunById(id).name}` };
});
app.tool("quit", () => {
  quitToMenu();
  return { detail: "Back at the main menu" };
});

let stopPose: (() => void) | null = null;

/**
 * The skeleton tells us where the body is, which the arm's readings leave out on purpose. It's only used for ducking
 * and stepping aside, and it costs about 5 fps on the TV, so it's only on when those can come up: in duels and
 * against the boss. It starts on the walk there, because the camera takes a moment to adjust. Leaning, for the waves and the cannon, comes from the arm's own readings.
 */
function syncPose(): void {
  const wanted = motion.on && app.can("sense.pose") && (match !== null || (rush !== null && rush.phase !== "rush" && rush.phase !== "clear"));
  if (wanted && !stopPose) {
    stopPose = app.sense.pose((frame) => {
      const now = performance.now();
      stance.update(frame.keypoints as Keypoint[], lastPoseAt ? (now - lastPoseAt) / 1000 : 0);
      lastPoseAt = now;
    }, { fps: TRACKING_RATE_HZ });
  } else if (!wanted && stopPose) {
    stopPose();
    stopPose = null;
    stance.reset();
  }
}

/** Starts camera tracking of both arms. One session lasts the whole game, as the docs advise. */
function startTracking(): void {
  if (motion.on) return;
  // The TV's tracking competes with the game for the machine, and each update it sends cost us a frame.
  // Measured on the device: 20 a second holds about 38 fps with uneven frames, 10 a second gives 45 and far fewer
  // long ones, and 10 is still the least the motion library accepts. The aim smooths over the gaps.
  const pacedApp = {
    observeEnter: app.observeEnter.bind(app),
    can: app.can.bind(app),
    sense: {
      motion: (handlers: Parameters<typeof app.sense.motion>[0], options: Parameters<typeof app.sense.motion>[1]) =>
        app.sense.motion(handlers, { ...options, rateHz: TRACKING_RATE_HZ }),
    },
  };
  const session = createMotionSession(pacedApp as unknown as Parameters<typeof createMotionSession>[0], { controls: ["right-hand-cursor", "left-hand-cursor", "torso-lateral-lean"] });
  const stopResult = session.onResult((result) => {
    motion.onControls(result.controls as unknown as CursorControl[]);
    lastLean = readLean(result.controls as unknown as Parameters<typeof readLean>[0]);
  });
  const stopStatus = session.onStatus((status) => {
    if (status.state !== trackingState || (status.reason ?? "") !== trackingReason) {
      trackingState = status.state;
      trackingReason = status.reason ?? "";
      console.info(`[ragebait] tracking: ${trackingState}${trackingReason ? ` (${trackingReason})` : ""}, ${status.cadence.negotiatedRateHz ?? "?"} Hz`);
    }
    // Terminal for this session. Stop on the next frame, not from inside its own callback.
    if (status.state === "unavailable") window.setTimeout(() => motion.markUnavailable(), 0);
  });
  motion.attach(() => {
    stopResult();
    stopStatus();
    stopPose?.();
    stopPose = null;
    stance.reset();
    session.close();
    trackingState = "off";
  });
}

/** Offers only the tools that make sense on the current screen. */
function syncTools(): void {
  if (screen === "menu") app.setActiveTools(["start_rush", "open_outfits", "open_settings"]);
  else if (screen === "shop") app.setActiveTools(["equip_gun", "quit"]);
  else app.setActiveTools(["quit"]);
}
syncTools();
hud.showCoins(wallet.coins, wallet.dev);
scene.setGun(wallet.equipped);

function setHostPaused(value: boolean): void {
  hostPaused = value;
  if (value) sfx.suspend();
  else sfx.resume();
  music.setMusic(!value);
  if (value) camera.pause();
  else camera.resume();
}
app.onPause(() => setHostPaused(true));
app.onResume(() => setHostPaused(false));

window.addEventListener("keydown", (e) => {
  if (keyName(e) !== "Escape" || e.repeat) return;
  // Back skips the camera check, the tutorial and the title.
  if (tutorial) finishTutorial();
  else if (screen === "camera") finishCameraCheck();
  else if (screen === "title") finishTitle();
  else if (screen === "opening") { if (opening) finishOpening(); }
  else if (screen === "shop") closeShop();
  else if (screen === "settings") closeSettings();
  else if (screen === "match" && match?.phase !== "results") paused = !paused;
  else if (screen === "menu") void app.exit();
  else quitToMenu();
});
window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  if (e.code === "KeyR") reloadKey = true;
});
window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  const key = keyName(e);
  if (screen === "settings") {
    if (key === "ArrowDown") settingsRowPresses += 1;
    if (key === "ArrowUp") settingsRowPresses -= 1;
    if (key === "ArrowRight") settingsValuePresses += 1;
    if (key === "ArrowLeft") settingsValuePresses -= 1;
  }
  if (screen !== "shop") return;
  if (key === "ArrowRight") shopPresses += 1;
  if (key === "ArrowLeft") shopPresses -= 1;
});
window.addEventListener("pointerdown", unlockAudio);
window.addEventListener("keydown", unlockAudio);

function handleEvent(event: MatchEvent): void {
  switch (event.type) {
    case "turn":
      remote.reset();
      // Quiet while aiming, so a real mic won't hear the game fill its own bar later.
      music.duck(0.22, rules.aimSec);
      break;
    case "fired":
      hud.shotFlash();
      scene.onFired();
      sfx.gunshot(rules.slowMoSec);
      break;
    case "impact":
      if (match) scene.onImpact(event.shot, match);
      if (event.shot.zone) {
        const drop = killCamFor(event.shot.zone, rules, event.shot.xray);
        // A lucky body x-ray gets the same crunch as a headshot.
        const sound = event.shot.xray ? "head" : event.shot.zone;
        sfx.hit(event.shot.shooter, event.shot.bar, sound, drop > 0 ? KILLCAM.contactSec : 0, drop);
      }
      if (!event.shot.zone) sfx.miss();
      break;
    case "results":
      if (match) scene.onResults(event.winner, match);
      sfx.fanfare();
      syncTools();
      break;
  }
}

function currentView(): View {
  if (rush && screen === "rush") return { kind: "rush", game: rush };
  if (screen === "shop") return { kind: "shop", showGun: shopSelected < GUNS.length };
  return match && screen === "match" ? { kind: "match", match } : { kind: "menu" };
}

/** The menu is a shooting gallery: aim at a sign and shoot it. */
function menuFrame(dt: number): void {
  const onTarget = scene.menuUpdate(dt, remote.aim());
  if (!remote.arrowsHeld) {
    const settle = scene.menuAssist();
    if (settle) remote.settleToward(settle, Math.min(1, dt * 9));
  }
  remote.reset();
  if (controls.consumeConfirm() && !startAt && !shopAt && !settingsAt && !quitAt) {
    const hit = scene.menuFire();
    hud.shotFlash();
    unlockAudio();
    // A real revolver shot, and a thud if it hit a sign.
    sfx.shot(hit !== null, false);
    if (hit) sfx.woodHit(false);
    music.duck(0.4, 0.35);
    if (hit?.id === "settings") {
      hud.banner(hit.message, OUTFITS_DELAY_SEC);
      settingsAt = clock + OUTFITS_DELAY_SEC;
    } else if (hit?.id === "outfits") {
      hud.banner(hit.message, OUTFITS_DELAY_SEC);
      shopAt = clock + OUTFITS_DELAY_SEC;
    } else if (hit?.id === "quit") {
      hud.banner(hit.message, QUIT_DELAY_SEC);
      quitAt = clock + QUIT_DELAY_SEC;
    } else if (hit) {
      hud.banner(hit.message, MENU_START_DELAY_SEC);
      startAt = { time: clock + MENU_START_DELAY_SEC, mode: "rush" };
    }
  }
  if (settingsAt && clock >= settingsAt) {
    settingsAt = 0;
    openSettings();
    return;
  }
  if (shopAt && clock >= shopAt) {
    shopAt = 0;
    openShop();
    return;
  }
  if (quitAt && clock >= quitAt) {
    quitAt = 0;
    void app.exit();
  }
  if (startAt && clock >= startAt.time) {
    if (startAt.mode === "rush") startOpening();
    else startMatch(startAt.mode);
  }
  hud.updateMenu(remote.aim(), onTarget, scene.shotsFired);
}

let accumulator = 0;
let last = performance.now();
let fps = 60;
let previousPhase = "";
let previousIntro = "";
let heldConfirm = false;

/** Where each frame's time goes, for the dev log: game rules, drawing, the HUD, and the worst gaps between frames. */
const perf = { frames: 0, update: 0, draw: 0, hud: 0, worstGap: 0, worstJs: 0, over40: 0, over70: 0, heap: 0, drops: 0, longTasks: 0, longMs: 0 };
try {
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      perf.longTasks += 1;
      perf.longMs += entry.duration;
    }
  }).observe({ entryTypes: ["longtask"] });
} catch {
  // Not every browser can say.
}
const TRACKING_RATE_HZ = 10;
/** The frame log: always in development, and with ?perf on the address in a real build. */
const PERF_LOG = import.meta.env.DEV || new URLSearchParams(location.search).has("perf");

function frame(now: number): void {
  requestAnimationFrame(frame);
  const gapMs = now - last;
  const startedAt = performance.now();
  const real = Math.min(0.1, (now - last) / 1000);
  last = now;
  fps += (1 / Math.max(real, 0.001) - fps) * 0.05;

  const frozen = paused || hostPaused || document.hidden;
  let dt = real;
  if (frozen) dt = 0;
  clock += dt;

  if (!frozen) {
    syncPose();
    motion.update(dt);
    if (performance.now() - lastPoseAt > POSE_STALE_MS) stance.reset();
    controls.bodyStep = stance.seen ? stance.step * STEP_DIRECTION : 0;
    controls.bodyDuck = stance.seen && stance.ducking;
    remote.update(dt);
    dummy.update(dt);
    dodgerTwoPlayer.update(dt);
    dodgerSolo.update(dt);
  }

  if (match && !frozen) {
    // Kept until the next fixed step, so a press on a frame without one still counts.
    let confirm = controls.consumeConfirm() || heldConfirm;
    if (match.phase === "handoff" && match.phaseTime < HANDOFF_GUARD_SEC) confirm = false;
    if (match.phase !== "handoff" && match.phase !== "intro" && match.phase !== "aim") confirm = false;

    accumulator += dt;
    while (accumulator >= STEP) {
      accumulator -= STEP;
      match.step(STEP, { ...inputsFor(match), confirm });
      confirm = false;
      for (const event of match.drainEvents()) handleEvent(event);
    }
    heldConfirm = confirm;

    if (match.phase === "intro") {
      const stage = introStage(match.phaseTime);
      if (stage !== previousIntro) {
        previousIntro = stage;
        sfx.stab(stage === "versus");
      }
    } else {
      previousIntro = "";
    }

    if (match.phase !== previousPhase) {
      previousPhase = match.phase;
      if (match.phase === "handoff") sfx.pass();
    }

  } else if (screen === "rush" && !frozen) {
    rushFrame(dt);
  } else if (screen === "menu" && !frozen) {
    menuFrame(dt);
  } else if (screen === "shop" && !frozen) {
    shopFrame();
  } else if (screen === "settings" && !frozen) {
    settingsFrame(dt);
  } else if (screen === "camera" && !frozen) {
    cameraCheckFrame(dt);
  } else if (screen === "opening" && !frozen) {
    const skip = controls.consumeConfirm();
    if (opening) {
      openingT += dt;
      if (skip || !opening.frame(openingT, 0, 0)) finishOpening();
    }
  } else if (screen === "title" && !frozen) {
    // A press skips the rest of the title.
    if (controls.consumeConfirm() || clock >= titleEndsAt) finishTitle();
  } else {
    controls.consumeConfirm();
  }

  if (!frozen) tutorialFrame(dt);
  // The crackle under anything burning: louder the more of the street's alight, and gone off the street.
  const burning = screen === "rush" && rush && !frozen
    ? rush.fires.length * 0.35 + rush.enemies.filter((e) => e.burning > 0).length * 0.5
    : 0;
  sfx.fireLoop(burning);
  const updatedAt = performance.now();
  // The storyboard and the title both paint over everything, so there's no need to draw the town under them.
  if (screen !== "opening" && screen !== "title") scene.render(currentView(), dt, 0);
  const drawnAt = performance.now();
  hud.tracking = motion.on;
  hud.update(screen, match, paused);
  hud.updatePointer(controls.mouse, controls.mouseUsed);
  if (PERF_LOG) {
    const end = performance.now();
    perf.frames += 1;
    perf.update += updatedAt - startedAt;
    perf.draw += drawnAt - updatedAt;
    perf.hud += end - drawnAt;
    perf.worstGap = Math.max(perf.worstGap, gapMs);
    perf.worstJs = Math.max(perf.worstJs, end - startedAt);
    if (gapMs > 40) perf.over40 += 1;
    if (gapMs > 70) perf.over70 += 1;
    const heap = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0;
    // The heap only ever shrinks when the collector runs, and that's what stutters.
    if (heap < perf.heap - 1e5) perf.drops += 1;
    perf.heap = heap;
  }
}

if (import.meta.env.DEV) {
  createDevPanel(root, {
    rules,
    match: () => match,
    setDummy: (behaviour) => {
      dummy.behaviour = behaviour;
    },
    setAutoSway: (on) => {
      dodgerTwoPlayer.autoDodge = on;
    },
    fps: () => fps,
    drawCalls: () => scene.drawCalls,
  });
  // Lets automated checks read the game without touching its internals.
  (window as unknown as { __game: unknown }).__game = {
    match: () => match,
    renderer: () => scene.describe(),
    drawCalls: () => scene.drawCalls,
    fps: () => fps,
    rules,
    start: startMatch,
    cameraLayout: (on: boolean) => camera.showLayout(on),
    tutorial: () => tutorial,
    replayTutorial: startTutorial,
    cameraCheck: () => cameraCheck,
    sfx,
    music,
    startCameraCheck,
    screen: () => screen,
    title: startTitle,
    rush: () => rush,
    scene,
    startRush,
    motion,
    /** Stands in for the camera, so arm aiming can be checked anywhere. */
    fakeHand: (x: number, y: number) => {
      if (!motion.on) motion.attach(() => {});
      const id = `${motion.arm}-hand-cursor`;
      motion.onControls([{ id, state: "active", value: { x, y }, range: [{ x: -1, y: -1 }, { x: 1, y: 1 }] }]);
    },
    /** Fast-forwards the match, so a check can reach any phase quickly. */
    advance: (seconds: number, confirmEachStep = false) => {
      if (!match) return;
      for (let i = 0; i < seconds / STEP; i++) {
        match.step(STEP, { ...inputsFor(match), confirm: confirmEachStep });
        for (const event of match.drainEvents()) handleEvent(event);
      }
    },
  };
}

console.info(`[ragebait] ${scene.describe()}`);
if (PERF_LOG) {
  // Shows up in `little dev events`, so frame rate can be read from a simulator or TV run.
  window.setInterval(() => {
    console.info(
      `[ragebait] ${perf.frames / 2} fps, ${scene.drawCalls} draws, hidden=${document.hidden}, ` +
        `ms update=${(perf.update / Math.max(1, perf.frames)).toFixed(1)} draw=${(perf.draw / Math.max(1, perf.frames)).toFixed(1)} hud=${(perf.hud / Math.max(1, perf.frames)).toFixed(1)} ` +
        `long=${perf.longTasks}/${perf.longMs.toFixed(0)}ms worst=${perf.worstGap.toFixed(0)} worstJs=${perf.worstJs.toFixed(0)} over40=${perf.over40} over70=${perf.over70} gc=${perf.drops} heap=${(perf.heap / 1e6).toFixed(0)}MB, ` +
        `phase=${screen === "match" ? match?.phase : screen}, tracking=${motion.state}` +
        (motion.raw ? ` arm=${motion.raw.x.toFixed(2)},${motion.raw.y.toFixed(2)}` : "") +
        (lastLean === null ? "" : ` lean=${lastLean.toFixed(2)}`) +
        (stance.seen ? ` step=${stance.step.toFixed(2)} duck=${stance.ducking}` : ""),
    );
    Object.assign(perf, { frames: 0, update: 0, draw: 0, hud: 0, worstGap: 0, worstJs: 0, over40: 0, over70: 0, drops: 0, longTasks: 0, longMs: 0 });
  }, 2000);
}
scene.load().then(async () => {
  await bakeOpening();
  // Better a moment more loading now than a freeze the first time each thing's drawn in the fight.
  const warmingFrom = performance.now();
  scene.prewarm();
  // The fight's HUD too, behind the loading screen, so showing it for the first time isn't a freeze of its own.
  // Sound too: setting it up the first time takes most of a second on the TV, and it's silent until the first press.
  unlockAudio();
  hud.prewarm(true);
  await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  hud.prewarm(false);
  console.info(`[ragebait] prewarmed in ${Math.round(performance.now() - warmingFrom)} ms`);
  last = performance.now();
  loaded = true;
  hud.loaded();
  tryAutoStartTracking();
  // Check the camera can see you. Then the first time, teach the game, and after that go straight to the title.
  // Unless the agent has already started something while this was loading.
  if (screen !== "rush") startCameraCheck();
  requestAnimationFrame(frame);
}).catch((error: unknown) => {
  console.error("[ragebait] Failed to load", error);
  hud.fail(error instanceof Error ? error.message : String(error));
});

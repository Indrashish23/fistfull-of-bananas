// A live tuning panel for development. Toggle it with the backquote key.

import type { Match, PlayerId } from "../game/match";
import type { Rules } from "../game/rules";
import type { DummyBehaviour } from "../input/inputs";

interface DevHooks {
  rules: Rules;
  match(): Match | null;
  setDummy(behaviour: DummyBehaviour): void;
  setAutoSway(on: boolean): void;
  fps(): number;
  drawCalls(): number;
}

const SLIDERS: [keyof Rules, string, number, number, number][] = [
  ["aimSec", "Aim timer", 3, 15, 1],
  ["slowMoSec", "Slo-mo", 0.5, 6, 0.5],
  ["impactSec", "Knockdown", 1, 6, 0.5],
  ["killCamSec", "Kill cam", 0.8, 4, 0.1],
  ["damageMin", "Damage min", 5, 40, 1],
  ["damageMax", "Damage max", 15, 80, 1],
  ["headMultiplier", "Headshot x", 1, 3, 0.1],
  ["nutsMultiplier", "Nut shot x", 1, 3, 0.1],
  ["reticleMin", "Reticle min", 0.1, 1, 0.05],
  ["reticleMax", "Reticle max", 0.5, 2, 0.05],
  ["walkSpeed", "Walk speed", 1, 8, 0.2],
  ["moveSensitivity", "Move sensitivity", 0.5, 3, 0.1],
  ["moveFollowPerSec", "Move response", 4, 40, 1],
  ["moveDeadzone", "Move deadzone", 0, 0.4, 0.01],
  ["aimFollowPerSec", "Aim response", 4, 40, 1],
  ["maxRounds", "Max rounds", 1, 12, 1],
];

export function createDevPanel(host: HTMLElement, hooks: DevHooks): void {
  const panel = document.createElement("div");
  panel.className = "dev";
  panel.innerHTML = `
    <h3>Dev panel</h3>
    <div class="row"><span data-out="stats"></span></div>
    ${SLIDERS.map(([key, label, min, max, step]) => `
      <label>${label}<input type="range" data-key="${key}" min="${min}" max="${max}" step="${step}" value="${hooks.rules[key]}"><span data-val="${key}">${hooks.rules[key]}</span></label>
    `).join("")}
    <div class="row">Dummy
      <select data-dummy>
        <option value="still">Stand still</option>
        <option value="sway" selected>Sway</option>
        <option value="random">Random</option>
      </select>
    </div>
    <label class="check"><input type="checkbox" data-sway checked> Target drifts when no keys are held</label>
    <div class="row">Next shooter
      <button data-shooter="0">Player 1</button>
      <button data-shooter="1">Player 2</button>
    </div>`;
  host.appendChild(panel);

  panel.querySelectorAll<HTMLInputElement>("input[data-key]").forEach((input) => {
    input.addEventListener("input", () => {
      const key = input.dataset.key as keyof Rules;
      hooks.rules[key] = Number(input.value);
      panel.querySelector(`[data-val="${key}"]`)!.textContent = input.value;
    });
  });
  panel.querySelector<HTMLSelectElement>("[data-dummy]")!.addEventListener("change", (e) => {
    hooks.setDummy((e.target as HTMLSelectElement).value as DummyBehaviour);
  });
  panel.querySelector<HTMLInputElement>("[data-sway]")!.addEventListener("change", (e) => {
    hooks.setAutoSway((e.target as HTMLInputElement).checked);
  });
  panel.querySelectorAll<HTMLButtonElement>("[data-shooter]").forEach((button) => {
    button.addEventListener("click", () => {
      const match = hooks.match();
      if (match && match.phase !== "results") match.setShooter(Number(button.dataset.shooter) as PlayerId);
    });
  });

  window.addEventListener("keydown", (e) => {
    if (e.code === "Backquote") panel.classList.toggle("open");
  });
  const stats = panel.querySelector("[data-out='stats']")!;
  window.setInterval(() => {
    if (panel.classList.contains("open")) {
      stats.textContent = `${Math.round(hooks.fps())} fps, ${hooks.drawCalls()} draws`;
    }
  }, 300);
}

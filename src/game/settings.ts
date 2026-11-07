// The player's settings, kept between sessions. What each aim level means is in rush.ts.

export type AimLevel = "off" | "soft" | "normal" | "hard";

/** In the order they come round on the settings screen. */
export const AIM_LEVEL_ORDER: readonly AimLevel[] = ["off", "soft", "normal", "hard"];

export const SETTINGS_KEY = "ragebait.settings.v2";

export interface Settings {
  aimLevel: AimLevel;
}

type Store = Pick<Storage, "getItem" | "setItem">;

/** Reads what's saved, and falls back to the defaults for anything it can't make sense of. */
export function loadSettings(store: Store | null): Settings {
  try {
    const saved = JSON.parse(store?.getItem(SETTINGS_KEY) ?? "null") as Partial<Settings> | null;
    if (saved && AIM_LEVEL_ORDER.includes(saved.aimLevel as AimLevel)) return { aimLevel: saved.aimLevel as AimLevel };
  } catch {
    // A corrupted save just means the defaults.
  }
  return { aimLevel: "soft" };
}

export function saveSettings(store: Store | null, settings: Settings): void {
  try {
    store?.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Private windows and full storage: it lasts until the page closes.
  }
}

/** The next level along, wrapping round at the ends. */
export function nextAimLevel(level: AimLevel, direction: number): AimLevel {
  const count = AIM_LEVEL_ORDER.length;
  return AIM_LEVEL_ORDER[(AIM_LEVEL_ORDER.indexOf(level) + direction + count) % count]!;
}

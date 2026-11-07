// Coins and the guns they've bought, kept between runs.

import { GUNS, gunById } from "./guns";

export const WALLET_KEY = "ragebait.wallet.v1";

export interface Wallet {
  coins: number;
  owned: string[];
  equipped: string;
  /** Dev mode: everything counts as yours, for free. What you've really bought is kept underneath. */
  dev?: boolean;
}

type Store = Pick<Storage, "getItem" | "setItem">;

const START: Wallet = { coins: 0, owned: ["revolver"], equipped: "revolver" };

/** Reads what's saved, and quietly starts over from anything it can't make sense of. */
export function loadWallet(store: Store | null): Wallet {
  try {
    const saved = JSON.parse(store?.getItem(WALLET_KEY) ?? "null") as Partial<Wallet> | null;
    if (!saved) return { ...START, owned: [...START.owned] };
    const owned = Array.isArray(saved.owned) ? saved.owned.filter((id) => GUNS.some((g) => g.id === id)) : [];
    if (!owned.includes("revolver")) owned.unshift("revolver");
    const coins = typeof saved.coins === "number" && Number.isFinite(saved.coins) ? Math.max(0, Math.floor(saved.coins)) : 0;
    const equipped = typeof saved.equipped === "string" && owned.includes(saved.equipped) ? saved.equipped : "revolver";
    const dev = saved.dev === true;
    // In dev mode any gun can be in your hand, so what's saved is only checked against what exists.
    const held = dev && typeof saved.equipped === "string" && GUNS.some((g) => g.id === saved.equipped) ? saved.equipped : equipped;
    return dev ? { coins, owned, equipped: held, dev } : { coins, owned, equipped };
  } catch {
    return { ...START, owned: [...START.owned] };
  }
}

export function saveWallet(store: Store | null, wallet: Wallet): void {
  try {
    store?.setItem(WALLET_KEY, JSON.stringify(wallet));
  } catch {
    // Private windows and full storage: the coins last until the page closes.
  }
}

/** What a run pays: its score, and a good bonus for finishing the job. */
export function coinsForRun(score: number, won: boolean): number {
  return Math.floor(Math.max(0, score) / 40) + (won ? 250 : 0);
}

/** Whether this gun's yours to use. */
export function ownsGun(wallet: Wallet, id: string): boolean {
  return wallet.dev === true ? GUNS.some((g) => g.id === id) : wallet.owned.includes(id);
}

/** Dev mode on or off. Going off puts you back on something you really own. */
export function toggleDev(wallet: Wallet): Wallet {
  if (!wallet.dev) return { ...wallet, dev: true };
  const { dev: _dev, ...rest } = wallet;
  return rest.owned.includes(rest.equipped) ? rest : { ...rest, equipped: "revolver" };
}

export function earn(wallet: Wallet, coins: number): Wallet {
  return { ...wallet, coins: wallet.coins + Math.max(0, Math.floor(coins)) };
}

/** Buys a gun and straps it on. Null if it's already yours or you can't afford it. */
export function buyGun(wallet: Wallet, id: string): Wallet | null {
  const gun = gunById(id);
  if (gun.id !== id || ownsGun(wallet, id) || wallet.coins < gun.price) return null;
  return { coins: wallet.coins - gun.price, owned: [...wallet.owned, id], equipped: id };
}

/** Straps on a gun you own. Anything else leaves things as they are. */
export function equipGun(wallet: Wallet, id: string): Wallet {
  return ownsGun(wallet, id) ? { ...wallet, equipped: id } : wallet;
}

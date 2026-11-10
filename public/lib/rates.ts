import { useEffect, useSyncExternalStore } from "react";
import { findCurrency } from "#shared/currencies.js";
import { api } from "./api";

/**
 * Live exchange rates and the currency the person has chosen to VIEW amounts in.
 *
 * Stored data never changes: every amount is saved in the business's own
 * currency. When a different display currency is chosen, fmtMoney() converts
 * on the way to the screen at the latest rate, so a rate that rises or falls
 * moves every figure with it. Rates are "per 1 USD" (see server rates.routes.js).
 */
type State = {
  display: string | null;          // code being viewed in, or null = the business's own currency
  rates: Record<string, number> | null;
  prevRates: Record<string, number> | null; // the rates before the latest change, for ▲/▼
  updatedAt: string | null;
  error: boolean;
};

const KEY = "startrack.displayCurrency";
const POLL_MS = 60_000;

function readSaved(): string | null {
  try { return localStorage.getItem(KEY) || null; } catch { return null; }
}

let state: State = { display: readSaved(), rates: null, prevRates: null, updatedAt: null, error: false };
const listeners = new Set<() => void>();
function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function setDisplayCurrency(code: string | null) {
  try { if (code) localStorage.setItem(KEY, code); else localStorage.removeItem(KEY); } catch { /* not remembered */ }
  set({ display: code });
}

let loading = false;
export async function refreshRates() {
  if (loading) return;
  loading = true;
  try {
    const r = await api<{ rates: Record<string, number>; updatedAt: string }>("/rates");
    const changed = state.rates && JSON.stringify(state.rates) !== JSON.stringify(r.rates);
    set({ rates: r.rates, prevRates: changed ? state.rates : state.prevRates, updatedAt: r.updatedAt, error: false });
  } catch {
    set({ error: true }); // keep showing the last rates we had
  } finally {
    loading = false;
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
function start() {
  if (timer) return;
  refreshRates();
  timer = setInterval(() => { if (!document.hidden) refreshRates(); }, POLL_MS);
  document.addEventListener("visibilitychange", onVisible);
}
function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  document.removeEventListener("visibilitychange", onVisible);
}
function onVisible() { if (!document.hidden) refreshRates(); }

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** Subscribes the component to rate changes. Polling runs only while a display currency is chosen. */
export function useRates() {
  return useSyncExternalStore(subscribe, () => state);
}

/** Polls for fresh rates while `active`; mounted once by the session provider. */
export function useRatePolling(active: boolean) {
  useEffect(() => {
    if (!active) return;
    start();
    return stop;
  }, [active]);
}

/** The amount in the display currency (rate-converted), given the symbol it is stored in. */
export function convertFromSymbol(n: number, symbol: string): { value: number; symbol: string } | null {
  const { display, rates } = state;
  if (!display || !rates) return null;
  const from = findCurrency(symbol);
  const to = findCurrency(display);
  if (!from || !to || from.code === to.code) return null;
  const rf = rates[from.code], rt = rates[to.code];
  if (!rf || !rt) return null;
  return { value: (n / rf) * rt, symbol: to.symbol };
}

/** Units of `to` per 1 `from`, now and at the previous refresh. */
export function pairRate(from: string, to: string) {
  const { rates, prevRates } = state;
  const at = (r: Record<string, number> | null) => (r && r[from] && r[to] ? r[to] / r[from] : null);
  return { now: at(rates), before: at(prevRates) };
}

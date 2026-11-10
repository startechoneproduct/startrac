import { Router } from "express";
import { CURRENCIES } from "#shared/currencies.js";

/**
 * Live exchange rates for the currencies a business can run in.
 *
 * GET /api/rates → { base: "USD", rates: { NGN: 1500, ... }, updatedAt, providerUpdatedAt }
 * Rates are "units of that currency per 1 USD", so any pair converts as
 * amount / rates[from] * rates[to]. They are fetched from a free public feed
 * and cached briefly here, so many open tabs cost one upstream call, and a
 * feed outage serves the last good rates instead of breaking the app.
 */
export const ratesRouter = Router();

const FEED = process.env.RATES_API_URL || "https://open.er-api.com/v6/latest/USD";
const TTL_MS = 5 * 60 * 1000;
let cache = null; // { rates, updatedAt, providerUpdatedAt }
let inflight = null;

async function pull() {
  const res = await fetch(FEED, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`rates feed ${res.status}`);
  const body = await res.json();
  if (body.result && body.result !== "success") throw new Error("rates feed refused");
  const all = body.rates || body.conversion_rates;
  if (!all) throw new Error("rates feed gave no rates");
  const rates = {};
  for (const c of CURRENCIES) {
    const r = Number(all[c.code]);
    if (Number.isFinite(r) && r > 0) rates[c.code] = r;
  }
  rates.USD = 1;
  const t = body.time_last_update_unix ? new Date(body.time_last_update_unix * 1000).toISOString() : null;
  cache = { rates, updatedAt: new Date().toISOString(), providerUpdatedAt: t };
}

async function ensureFresh() {
  if (cache && Date.now() - new Date(cache.updatedAt).getTime() < TTL_MS) return;
  inflight ||= pull().finally(() => { inflight = null; });
  try { await inflight; } catch (err) {
    if (!cache) throw err; // nothing to fall back on
    console.warn("Rates refresh failed, serving the last good rates:", err.message);
    cache.updatedAt = new Date(Date.now() - TTL_MS + 30_000).toISOString(); // retry in 30s, not on every request
  }
}

ratesRouter.get("/", async (_req, res) => {
  try {
    await ensureFresh();
  } catch (err) {
    console.error("Rates unavailable:", err.message);
    return res.status(503).json({ error: "rates_unavailable", message: "Live exchange rates aren't available right now." });
  }
  res.set("Cache-Control", "no-store");
  res.json({ base: "USD", ...cache });
});

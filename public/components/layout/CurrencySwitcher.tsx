import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Coins } from "lucide-react";
import { CURRENCIES, currencyCodeOf, findCurrency } from "#shared/currencies.js";
import { pairRate, refreshRates, setDisplayCurrency, useRates } from "@/lib/rates";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

/**
 * View every amount in another currency at the live exchange rate. Nothing
 * stored changes — only what's shown. While a currency is chosen the rate is
 * re-fetched every minute and the figures (and the ▲/▼ here) follow it.
 */
export function CurrencySwitcher() {
  const { activeBusiness } = useSession();
  const rs = useRates();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);
  // Load rates when the menu opens so the list can show them.
  useEffect(() => { if (open && !rs.rates) refreshRates(); }, [open, rs.rates]);

  if (!activeBusiness) return null;
  const baseCode = currencyCodeOf(activeBusiness.settings);
  if (!findCurrency(baseCode)) return null;
  const display = rs.display && rs.display !== baseCode ? rs.display : null;
  const { now, before } = display ? pairRate(baseCode, display) : { now: null, before: null };
  const dir = now && before && now !== before ? (now > before ? "up" : "down") : null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={display ? `Showing amounts in ${display} at the live rate` : "View amounts in another currency"}
        className={cn(
          "flex items-center gap-1.5 h-10 px-3 rounded-full border text-[13px] font-bold transition-colors",
          display ? "border-primary text-primary bg-primary-soft" : "border-line-2 bg-surface text-t2 hover:text-primary hover:border-primary",
        )}
      >
        <Coins className="w-4 h-4" />
        <span className="max-sm:hidden">{display || baseCode}</span>
        {dir === "up" && <ArrowUp className="w-3.5 h-3.5 text-success" />}
        {dir === "down" && <ArrowDown className="w-3.5 h-3.5 text-danger" />}
        <ChevronDown className="w-3.5 h-3.5 max-sm:hidden" />
      </button>
      {open && (
        <div className="absolute top-full mt-2 right-0 w-72 pop border border-line rounded-2xl shadow-e2 py-2 z-50 max-h-[70vh] overflow-y-auto">
          <div className="px-4 py-1.5 text-[12px] font-semibold text-t3">
            View amounts in · live rate vs {baseCode}
          </div>
          <button onClick={() => { setDisplayCurrency(null); setOpen(false); }} className={cn("w-full text-left px-4 py-2.5 text-[13px] font-medium hover:bg-surface-3", !display ? "text-primary" : "text-t2")}>
            My currency ({baseCode})
          </button>
          {CURRENCIES.filter((c) => c.code !== baseCode).map((c) => {
            const r = rs.rates && rs.rates[baseCode] && rs.rates[c.code] ? rs.rates[c.code] / rs.rates[baseCode] : null;
            return (
              <button key={c.code} onClick={() => { setDisplayCurrency(c.code); setOpen(false); }} className={cn("w-full flex items-center justify-between gap-3 text-left px-4 py-2.5 text-[13px] font-medium hover:bg-surface-3", display === c.code ? "text-primary" : "text-t2")}>
                <span className="truncate">{c.symbol} {c.name}</span>
                <span className="font-mono text-[12px] text-t3 shrink-0">{r ? `1 ${baseCode} = ${r.toLocaleString("en", { maximumSignificantDigits: 5 })} ${c.code}` : c.code}</span>
              </button>
            );
          })}
          <div className="px-4 pt-2 mt-1 border-t border-line text-[11px] text-t3">
            {rs.error && !rs.rates ? "Rates unavailable right now." : rs.updatedAt ? `Rates refreshed ${new Date(rs.updatedAt).toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" })}.` : "Loading rates…"} Receipts and invoices keep your own currency.
          </div>
        </div>
      )}
    </div>
  );
}

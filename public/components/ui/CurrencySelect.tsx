import { CURRENCIES, findCurrency } from "#shared/currencies.js";
import { Select } from "@/components/ui/Field";

/**
 * Picks a business's currency from the shared list. The value is the code
 * ("NGN"). A symbol typed by hand before the list existed (stored with no
 * code) shows as its own choice, so opening Settings never silently changes it.
 */
export function CurrencySelect({ value, legacySymbol, onChange, id, className }: {
  value: string;
  legacySymbol?: string;
  onChange: (code: string) => void;
  id?: string;
  className?: string;
}) {
  const legacy = legacySymbol && !findCurrency(legacySymbol) ? legacySymbol : "";
  return (
    <Select id={id} className={className} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Currency">
      {legacy && <option value={legacy}>{legacy} (current)</option>}
      {CURRENCIES.map((c) => (
        <option key={c.code} value={c.code}>{c.symbol}  {c.name} ({c.code})</option>
      ))}
    </Select>
  );
}

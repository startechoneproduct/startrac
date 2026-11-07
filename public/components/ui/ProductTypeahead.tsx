import { useId, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/Field";
import { fuzzySearch } from "@/lib/fuzzy";
import { cn } from "@/lib/utils";

type Item = { id: string; name: string; sku?: string; barcode?: string; category?: string };

/**
 * Pick one product by typing: matches appear as you type, spelling slips
 * included (see lib/fuzzy.ts). Arrow keys move through them, Enter picks,
 * Escape closes. Once picked it shows the product with a clear button.
 */
export function ProductTypeahead({ products, value, onChange, placeholder = "Type a product name", label = "Product" }: {
  products: Item[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  label?: string;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const chosen = products.find((p) => p.id === value);
  const matches = useMemo(() => (text.trim() ? fuzzySearch(products, text, (p) => [p.name, p.sku, p.barcode, p.category], 8) : []), [products, text]);

  function pick(p: Item) {
    onChange(p.id);
    setText("");
    setOpen(false);
  }

  if (chosen) {
    return (
      <div className="flex items-center gap-2 h-10 px-3.5 rounded-xl border border-primary/40 bg-primary-softer text-[13px]">
        <span className="font-semibold text-t1 truncate flex-1">{chosen.name}</span>
        <button type="button" onClick={() => onChange("")} aria-label={`Clear ${chosen.name}`} className="p-1 rounded text-t3 hover:text-danger"><X className="w-4 h-4" /></button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Search className="w-4 h-4 text-t4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
      <Input
        role="combobox"
        aria-label={label}
        aria-expanded={open && matches.length > 0}
        aria-controls={listId}
        aria-activedescendant={open && matches[active] ? `${listId}-${active}` : undefined}
        value={text}
        placeholder={placeholder}
        className="!pl-9"
        onChange={(e) => { setText(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, matches.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
          else if (e.key === "Enter" && open && matches[active]) { e.preventDefault(); pick(matches[active]); }
          else if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && text.trim() && (
        <div id={listId} role="listbox" className="absolute z-30 left-0 right-0 mt-1 rounded-xl border border-line-2 bg-surface shadow-e2 overflow-hidden">
          {matches.length === 0 ? (
            <div className="px-3.5 py-2.5 text-[12.5px] text-t3">No product looks like "{text.trim()}".</div>
          ) : matches.map((p, i) => (
            <button
              key={p.id} id={`${listId}-${i}`} type="button" role="option" aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()} onClick={() => pick(p)} onMouseEnter={() => setActive(i)}
              className={cn("w-full flex items-center gap-2 px-3.5 py-2 text-left text-[13px]", i === active ? "bg-primary-softer" : "hover:bg-surface-2")}
            >
              <span className="flex-1 min-w-0 truncate font-semibold text-t1">{p.name}</span>
              {p.sku && <span className="text-[11px] font-mono text-t4">{p.sku}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

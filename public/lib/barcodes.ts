import JsBarcode from "jsbarcode";
import QRCode from "qrcode";

/**
 * Barcode label sheets — faithful port of the legacy printBarcodes:
 * CODE128 or QR labels (name + price + code), size presets mapping to
 * column counts, optional cut lines, A4 print window with Print /
 * Save-as-PDF buttons.
 */
export type LabelItem = { name: string; code: string; priceLabel: string };
export type LabelKind = "barcode" | "qr";

/**
 * What a product's label encodes: its own barcode if it has one, else its SKU
 * (short, so the printed barcode stays narrow enough to scan easily), else a
 * code made from its id, so EVERY product can be labelled and scanned. The till
 * matches all three (see matchesProductCode), so labels printed before keep working.
 */
export const productCode = (p: { id: string; barcode?: string; sku?: string }) => p.barcode || p.sku || `ST:${p.id}`;
export const matchesProductCode = (p: { id: string; barcode?: string; sku?: string }, scanned: string) => {
  const c = scanned.trim();
  return !!c && (p.barcode === c || c === `ST:${p.id}` || (!!p.sku && p.sku.toLowerCase() === c.toLowerCase()));
};
export type LabelSize = "small" | "medium" | "large" | "sheet";

const COLS: Record<LabelSize, string> = {
  small: "repeat(4,1fr)",
  medium: "repeat(3,1fr)",
  large: "repeat(2,1fr)",
  sheet: "repeat(5,1fr)",
};

function barcodeSvg(code: string): string {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  try {
    JsBarcode(svg, code, {
      format: "CODE128",
      displayValue: true,
      fontSize: 12,
      height: 44,
      margin: 4,
    });
  } catch {
    return `<div style="font-size:9px;color:#dc2626">invalid code</div>`;
  }
  return svg.outerHTML;
}

// Drawn from the QR matrix directly (no async image step), so a print window can be opened inside the click.
function qrSvg(code: string): string {
  const q = QRCode.create(code, { errorCorrectionLevel: "M" });
  const n = q.modules.size;
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.modules.get(r, c)) d += `M${c},${r}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" class="qr" viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges"><path d="${d}"/></svg><div class="bc-code">${code.replace(/</g, "&lt;")}</div>`;
}

export function printBarcodeLabels(items: LabelItem[], opts: { size: LabelSize; copies: number; cutLines: boolean; kind?: LabelKind }) {
  const { size, copies, cutLines, kind = "barcode" } = opts;
  const cols = COLS[size] || COLS.medium;

  const labels: string[] = [];
  for (const item of items) {
    const svg = kind === "qr" ? qrSvg(item.code) : barcodeSvg(item.code);
    for (let c = 0; c < copies; c++) {
      labels.push(
        `<div class="bc-label">${svg}` +
          `<div class="bc-name">${item.name.replace(/</g, "&lt;")}</div>` +
          `<div class="bc-price">${item.priceLabel}</div>` +
        `</div>`
      );
    }
  }

  const w = window.open("", "_blank", "width=950,height=750");
  if (!w) return false;
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>StarTrack Labels</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',system-ui,sans-serif;background:#fff;padding:12px}
  .nop{display:flex;gap:8px;justify-content:center;padding:10px;margin-bottom:14px;background:#f8fafd;border-bottom:1px solid #e0e7f0}
  .nop button{padding:8px 18px;border:none;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer}
  .pb{background:#2254e0;color:#fff}.cb{background:#6b7280;color:#fff}
  .grid{display:grid;width:100%;grid-template-columns:${cols};gap:${cutLines ? "0" : "6px"};background:${cutLines ? "#e0e7f0" : "#fff"};padding:${cutLines ? "1px" : "0"}}
  .bc-label{background:#fff;${cutLines ? "border:1px dashed #c8d3e8;" : "border:1px solid #e8eef8;border-radius:7px;"}padding:8px 6px 6px;text-align:center;page-break-inside:avoid;break-inside:avoid;overflow:hidden;width:100%;min-width:0}
  .bc-label svg{width:100%!important;height:auto!important;max-width:100%!important;display:block}
  .bc-label svg.qr{width:70%!important;max-width:120px!important;margin:0 auto;fill:#0a1628}
  .bc-code{font-family:'Courier New',monospace;font-size:8px;color:#6b7280;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .bc-name{font-size:9.5px;font-weight:800;color:#0a1628;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .bc-price{font-family:'Courier New',monospace;font-size:9.5px;font-weight:700;color:#2254e0;margin-top:2px}
  @media print{.nop{display:none!important}@page{size:A4;margin:6mm}body{padding:0}.bc-label{page-break-inside:avoid;break-inside:avoid}}
</style></head><body>
  <div class="nop">
    <button class="pb" onclick="window.print()">Print / Save as PDF</button>
    <button class="cb" onclick="window.close()">Close</button>
  </div>
  <div class="grid">${labels.join("")}</div>
  <script>window.onload=function(){setTimeout(function(){window.print()},600)}<\/script>
</body></html>`);
  w.document.close();
  return true;
}

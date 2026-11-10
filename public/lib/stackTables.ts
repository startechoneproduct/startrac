/**
 * Phone-friendly tables, for every table in the app at once.
 *
 * On a narrow screen a wide table can only scroll sideways, showing two or
 * three columns at a time. Instead, index.css restacks each row as a card
 * (`table[data-stack]`): the first cell is the card's title and every other
 * cell becomes a "Label … value" line. CSS can't know a cell's column name,
 * so this labels each cell from its table's own header row, and keeps doing
 * so as tables render, re-render and appear (lists loading, dialogs opening).
 *
 * A table opts out with `data-no-stack` (a spreadsheet preview, say, is
 * meant to look like a grid). Tablets and desktops are unaffected: the CSS
 * only applies below the `sm` breakpoint.
 */
const SCOPE = "main table, [role='dialog'] table";

function label(table: HTMLTableElement) {
  if (table.hasAttribute("data-no-stack")) return;
  const heads = [...table.querySelectorAll("thead tr:last-child th, thead tr:last-child td")].map((th) => (th.textContent || "").trim());
  if (!heads.length) return;
  if (!table.hasAttribute("data-stack")) table.setAttribute("data-stack", "");
  for (const tr of table.querySelectorAll<HTMLTableRowElement>(":scope > tbody > tr, :scope > tfoot > tr")) {
    let col = 0;
    for (const cell of tr.cells) {
      const text = heads[col] ?? "";
      if (cell.getAttribute("data-label") !== text) cell.setAttribute("data-label", text);
      col += cell.colSpan || 1;
    }
  }
}

export function startStackingTables() {
  let queued = false;
  const run = () => {
    queued = false;
    document.querySelectorAll<HTMLTableElement>(SCOPE).forEach(label);
  };
  // Only structure and text changes matter. Attributes aren't watched, so
  // the labels written above never retrigger this.
  new MutationObserver(() => {
    if (!queued) { queued = true; requestAnimationFrame(run); }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
  run();
}

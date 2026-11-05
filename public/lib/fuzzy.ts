/**
 * Forgiving product search: finds what people mean, not only what they typed
 * exactly. "coca", "cocacola", "coca cola 35", "cokacola" and "35cl coke" all
 * find "Coca-Cola 35cl". Used at the till and anywhere a product is picked by
 * typing.
 *
 * How a name is scored against what was typed (higher is better):
 *   the whole name starts with it / contains it        strongest
 *   every typed word starts a word in the name         strong
 *   every typed word is found inside the name          good
 *   every typed word is within a small typo of a word  fair (1 slip in 4+ letters, 2 in 8+)
 *   the letters appear in order ("cclca" → "coca-cola") weakest
 * Codes (SKU, barcode) and the category count too, so a partial code works.
 */

const fold = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** Letters and digits only, words split on anything else. */
const words = (s: string) => fold(s).split(/[^a-z0-9]+/).filter(Boolean);
const squash = (s: string) => fold(s).replace(/[^a-z0-9]+/g, "");

/** Edit distance with swaps (Damerau-Levenshtein), stopping early past `max`. */
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      rowMin = Math.min(rowMin, d[i][j]);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}
const slipsAllowed = (len: number) => (len >= 8 ? 2 : len >= 4 ? 1 : 0);

/** Does a typed word nearly match some word in the name (or its start)? */
function nearWord(token: string, nameWords: string[]): boolean {
  const max = slipsAllowed(token.length);
  if (!max) return false;
  return nameWords.some((w) => distance(token, w, max) <= max || (w.length > token.length && distance(token, w.slice(0, token.length), max) <= max));
}

/** The letters of `q` appear in `s` in order. */
function inOrder(q: string, s: string): boolean {
  let i = 0;
  for (const ch of s) if (ch === q[i]) i++;
  return i === q.length;
}

/** How well `query` matches `text`: 0 means no match. */
export function fuzzyScore(query: string, text: string): number {
  const q = squash(query);
  if (!q) return 0;
  const name = squash(text);
  if (!name) return 0;
  if (name.startsWith(q)) return 100;
  if (name.includes(q)) return 85;
  const qWords = words(query);
  const nWords = words(text);
  if (qWords.every((t) => nWords.some((w) => w.startsWith(t)))) return 75;
  if (qWords.every((t) => name.includes(t))) return 65;
  // Words run together ("cocacola") or typed with slips ("cokacola", "pek milk").
  const close = qWords.filter((t) => name.includes(t) || nWords.some((w) => w.startsWith(t)) || nearWord(t, nWords) || nearWord(t, [name])).length;
  if (close === qWords.length) return 50;
  if (q.length >= 3 && inOrder(q, name)) return 25;
  return 0;
}

/**
 * The items that match, best first. `fields` names what to search on each
 * item; the first one (usually the name) counts most.
 */
export function fuzzySearch<T>(items: T[], query: string, fields: (item: T) => (string | undefined | null)[], limit = Infinity): T[] {
  if (!squash(query)) return items.slice(0, limit);
  const scored: { item: T; score: number; i: number }[] = [];
  items.forEach((item, i) => {
    const [main, ...rest] = fields(item);
    let score = fuzzyScore(query, main || "");
    for (const f of rest) if (f) score = Math.max(score, fuzzyScore(query, f) - 10);
    if (score > 0) scored.push({ item, score, i });
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.slice(0, limit).map((s) => s.item);
}

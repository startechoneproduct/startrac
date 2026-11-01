import fs from "node:fs";
import { MAILBOX } from "./smtp";

/** Reads the emails the app sent to the pretend mail server (see smtp.ts). */
export type Mail = { from: string; to: string[]; subject: string; text: string; html: string };

const qp = (s: string) => s.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
const utf8 = (bin: string) => Buffer.from(bin, "binary").toString("utf8");

function decodeHeaderWords(v: string) {
  return v.replace(/=\?UTF-8\?([QB])\?([^?]*)\?=/gi, (_, enc, body) =>
    enc.toUpperCase() === "B" ? Buffer.from(body, "base64").toString("utf8") : utf8(qp(body.replace(/_/g, " "))));
}

function body(part: string): string {
  const [head, ...rest] = part.split(/\r?\n\r?\n/);
  const content = rest.join("\n\n");
  const enc = /content-transfer-encoding:\s*(\S+)/i.exec(head)?.[1]?.toLowerCase();
  if (enc === "base64") return Buffer.from(content.replace(/\s+/g, ""), "base64").toString("utf8");
  if (enc === "quoted-printable") return utf8(qp(content));
  return content;
}

export function parseMail(raw: string, from: string, to: string[]): Mail {
  const [headBlock, ...rest] = raw.split(/\r?\n\r?\n/);
  // Unfold long headers (the fold keeps its space), and rejoin an encoded word that was split across lines.
  const headers = headBlock.replace(/\r?\n([ \t])/g, "$1").replace(/(\?=)\s+(=\?UTF-8\?[QB]\?)/gi, "$1$2");
  const subject = decodeHeaderWords(/^subject:\s*(.*)$/im.exec(headers)?.[1] || "");
  const boundary = /boundary="?([^";\s]+)"?/i.exec(headers)?.[1];
  let text = "", html = "";
  const content = rest.join("\n\n");
  if (boundary) {
    for (const part of content.split(`--${boundary}`)) {
      if (/content-type:\s*text\/plain/i.test(part)) text = body(part);
      else if (/content-type:\s*text\/html/i.test(part)) html = body(part);
    }
  } else if (/content-type:\s*text\/html/i.test(headers)) html = body(`${headBlock}\n\n${content}`);
  else text = body(`${headBlock}\n\n${content}`);
  return { from, to, subject, text, html };
}

export const allMail = (): Mail[] =>
  fs.existsSync(MAILBOX)
    ? fs.readFileSync(MAILBOX, "utf8").split("\n").filter(Boolean).map((l) => { const m = JSON.parse(l); return parseMail(m.raw, m.from, m.to); })
    : [];

/** Waits for an email addressed to `address` (optionally matching `subject`) and returns the newest such one. */
export async function mailTo(address: string, subject?: RegExp, timeoutMs = 12_000): Promise<Mail> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const hit = allMail().filter((m) => m.to.some((t) => t.toLowerCase() === address.toLowerCase()) && (!subject || subject.test(m.subject))).at(-1);
    if (hit) return hit;
    if (Date.now() > end) throw new Error(`No email to ${address}${subject ? ` matching ${subject}` : ""} arrived within ${timeoutMs / 1000}s. Got: ${JSON.stringify(allMail().map((m) => [m.to, m.subject]))}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** The 6-digit code in a verification email. */
export const codeIn = (m: Mail) => /\b(\d{6})\b/.exec(`${m.text} ${m.html.replace(/<[^>]+>/g, " ")}`)?.[1] ?? "";

/** Waits for a verification email whose code differs from `previous` (a fresh one was just requested). */
export async function newCode(address: string, previous: string, timeoutMs = 12_000): Promise<string> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const code = codeIn(await mailTo(address, /Verify your email/, timeoutMs));
    if (code && code !== previous) return code;
    if (Date.now() > end) throw new Error(`No new code arrived for ${address}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

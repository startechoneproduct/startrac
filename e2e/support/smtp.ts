import fs from "node:fs";
import net from "node:net";
import path from "node:path";

/**
 * A tiny pretend mail server for the tests. The app talks to it over real SMTP
 * (login included), so what is tested is the same code path as Gmail, but
 * nothing ever leaves this machine and every email can be read back.
 *
 * It runs in the test runner's process and appends each message to a file the
 * test workers read (see mailbox.ts).
 */
export const SMTP_PORT = 2525;
export const MAILBOX = path.resolve(import.meta.dirname, "..", "..", "test-results", "mailbox.jsonl");

export function startFakeSmtp(): Promise<() => Promise<void>> {
  fs.mkdirSync(path.dirname(MAILBOX), { recursive: true });
  fs.writeFileSync(MAILBOX, "");

  const server = net.createServer((sock) => {
    sock.setEncoding("utf8");
    let buf = "";
    let mode: "cmd" | "data" | "auth-user" | "auth-pass" | "auth-plain" = "cmd";
    let from = "";
    let rcpt: string[] = [];
    let data = "";
    const reply = (s: string) => sock.write(s + "\r\n");
    reply("220 fake-smtp ready");

    sock.on("data", (chunk: string) => {
      buf += chunk;
      for (;;) {
        if (mode === "data") {
          const end = buf.indexOf("\r\n.\r\n");
          if (end < 0) return;
          data = buf.slice(0, end);
          buf = buf.slice(end + 5);
          fs.appendFileSync(MAILBOX, JSON.stringify({ from, to: rcpt, raw: data.replace(/^\.\./gm, ".") }) + "\n");
          from = ""; rcpt = []; data = "";
          mode = "cmd";
          reply("250 queued");
          continue;
        }
        const nl = buf.indexOf("\r\n");
        if (nl < 0) return;
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 2);

        if (mode === "auth-user") { mode = "auth-pass"; reply("334 UGFzc3dvcmQ6"); continue; }
        if (mode === "auth-pass" || mode === "auth-plain") { mode = "cmd"; reply("235 2.7.0 Authentication successful"); continue; }

        const cmd = line.toUpperCase();
        if (cmd.startsWith("EHLO") || cmd.startsWith("HELO")) { sock.write("250-fake-smtp\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n"); }
        else if (cmd.startsWith("AUTH PLAIN")) { if (line.length > 11) reply("235 2.7.0 Authentication successful"); else { mode = "auth-plain"; reply("334 "); } }
        else if (cmd.startsWith("AUTH LOGIN")) { mode = "auth-user"; reply("334 VXNlcm5hbWU6"); }
        else if (cmd.startsWith("MAIL FROM")) { from = line.slice(10).replace(/[<>]/g, "").split(" ")[0].trim(); reply("250 ok"); }
        else if (cmd.startsWith("RCPT TO")) { rcpt.push(line.slice(8).replace(/[<>]/g, "").trim()); reply("250 ok"); }
        else if (cmd === "DATA") { mode = "data"; reply("354 end with <CRLF>.<CRLF>"); }
        else if (cmd === "RSET") { from = ""; rcpt = []; reply("250 ok"); }
        else if (cmd === "NOOP") reply("250 ok");
        else if (cmd === "QUIT") { reply("221 bye"); sock.end(); return; }
        else reply("250 ok");
      }
    });
    sock.on("error", () => {});
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(SMTP_PORT, "127.0.0.1", () => resolve(() => new Promise<void>((done) => server.close(() => done()))));
  });
}

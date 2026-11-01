import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ErrorBanner, Field, Input } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/api";

/**
 * "I forgot my password": ask for the email, then enter the code that was sent
 * to it and choose a new password. Whether or not the address has an account,
 * the first step answers the same, so it can't be used to find out who does.
 */
export function ForgotPassword({ open, initialEmail, onClose, onDone }: {
  open: boolean; initialEmail: string; onClose: () => void; onDone: (email: string) => void;
}) {
  const [step, setStep] = useState<"ask" | "code" | "done">("ask");
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const close = () => { setStep("ask"); setCode(""); setPassword(""); setAgain(""); setError(""); onClose(); };

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try { await api("/auth/forgot", { method: "POST", body: JSON.stringify({ email: email.trim() }) }); setStep("code"); }
    catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }

  async function reset(e: React.FormEvent) {
    e.preventDefault();
    if (password !== again) { setError("The two passwords don't match."); return; }
    setBusy(true); setError("");
    try { await api("/auth/reset", { method: "POST", body: JSON.stringify({ email: email.trim(), code, password }) }); setStep("done"); }
    catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={close} title="Reset your password" subtitle={step === "ask" ? "We'll email you a code." : step === "code" ? `Enter the code we sent to ${email.trim()}.` : ""}>
      {step === "ask" && (
        <form onSubmit={ask} className="space-y-3">
          <ErrorBanner message={error} />
          <Field label="Your email address"><Input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email address for password reset" /></Field>
          <Button type="submit" className="w-full" disabled={busy || !email.trim()}>{busy ? "Sending…" : "Email me a code"}</Button>
        </form>
      )}
      {step === "code" && (
        <form onSubmit={reset} className="space-y-3">
          <ErrorBanner message={error} />
          <p className="text-[12.5px] text-t3">If that address has an account, the code is on its way. It can take a minute. It expires in 10 minutes.</p>
          <Field label="6-digit code"><Input required inputMode="numeric" autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="123456" aria-label="Reset code" className="font-mono tracking-[0.3em]" /></Field>
          <Field label="New password" hint="At least 6 characters"><Input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} aria-label="New password" /></Field>
          <Field label="New password again"><Input type="password" required minLength={6} value={again} onChange={(e) => setAgain(e.target.value)} aria-label="New password again" /></Field>
          <Button type="submit" className="w-full" disabled={busy || code.length < 4 || password.length < 6}>{busy ? "Saving…" : "Set new password"}</Button>
          <button type="button" className="text-[12px] font-semibold text-primary hover:underline" onClick={() => { setStep("ask"); setError(""); }}>Send a new code</button>
        </form>
      )}
      {step === "done" && (
        <div className="text-center space-y-3 py-2">
          <CheckCircle2 className="w-11 h-11 text-success mx-auto" />
          <p className="text-[14px] font-semibold text-t1">Your password has been changed.</p>
          <p className="text-[12.5px] text-t3">Sign in with your new password.</p>
          <Button className="w-full" onClick={() => { const e = email.trim(); close(); onDone(e); }}>Back to sign in</Button>
        </div>
      )}
    </Modal>
  );
}

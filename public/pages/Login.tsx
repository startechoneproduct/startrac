import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LockOpen, AlertCircle, KeyRound, Delete } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { isPlatformUser, useSession } from "@/lib/session";
import { BrandMark } from "@/components/brand/BrandMark";
import { ForgotPassword } from "@/components/auth/ForgotPassword";
import { cn } from "@/lib/utils";

const KEYPAD_MAX = 4; // a till PIN is exactly four digits

export function Login() {
  const navigate = useNavigate();
  const { login, tillLogin } = useSession();
  const [tab, setTab] = useState<"account" | "till">("account");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [businessCode, setBusinessCode] = useState(() => localStorage.getItem("startrack.tillCode") || "");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (tab === "account") {
        const s = await login(email.trim(), password);
        // StarTrack staff have their own console; everyone else lands in their business.
        navigate(isPlatformUser(s) ? "/admin" : "/app/dashboard");
      } else {
        await tillLogin(businessCode.trim(), pin);
        // Remember the code on this device — staff only type their PIN next time.
        localStorage.setItem("startrack.tillCode", businessCode.trim().toUpperCase());
        navigate("/app/pos");
      }
    } catch (err: any) {
      setError(err.message || "Could not sign in");
      if (tab === "till") setPin("");
    } finally {
      setBusy(false);
    }
  }

  function pressDigit(d: string) {
    setError("");
    setPin((p) => (p.length < KEYPAD_MAX ? p + d : p));
  }

  const inputCls =
    "w-full h-11 px-3.5 rounded-ctl bg-surface border border-line-2 text-[14px] text-t1 placeholder:text-t4 hover:border-t4 focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-primary-soft transition-[border-color,box-shadow]";

  return (
    <div className="h-full flex items-center justify-center bg-canvas relative overflow-hidden">
      <div className="absolute top-5 right-5"><ThemeToggle /></div>
      <div className="relative w-[420px] max-w-[92vw] rounded-[24px] shadow-lg2 bg-surface border border-line p-9 text-center animate-fade-up">
        <Link to="/" className="inline-flex mb-5" aria-label="StarTrack home"><BrandMark className="w-12 h-12" /></Link>
        <h1 className="text-[22px] font-semibold text-t1">Welcome back</h1>
        <p className="text-[13px] text-t3 mt-1 mb-6">Sign in to your business</p>

        {/* Mode tabs */}
        <div className="grid grid-cols-2 gap-0.5 p-0.5 rounded-ctl bg-surface-3 mb-5">
          {([
            { k: "account", label: "Account" },
            { k: "till", label: "Staff PIN" },
          ] as const).map((t) => (
            <button
              key={t.k}
              type="button"
              onClick={() => { setTab(t.k); setError(""); setPin(""); }}
              className={cn(
                "h-8 rounded-md text-[13px] font-medium transition-colors",
                tab === t.k ? "bg-surface text-t1 shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-t3 hover:text-t1"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="flex items-center gap-2 text-left px-3 py-2.5 mb-4 rounded-ctl bg-danger-soft text-danger text-[12.5px] font-medium">
            <AlertCircle className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}

        <form onSubmit={submit} className="space-y-3 text-left">
          {tab === "account" ? (
            <>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" className={inputCls} />
              <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className={inputCls} />
              <div className="text-right -mt-1"><button type="button" onClick={() => setForgot(true)} className="text-[12px] font-semibold text-primary hover:underline">Forgot password?</button></div>
              <Button type="submit" size="lg" className="w-full mt-2" disabled={busy}>
                <LockOpen className="w-4 h-4" /> {busy ? "Signing in…" : "Sign In"}
              </Button>
            </>
          ) : (
            <>
              <input
                required
                value={businessCode}
                onChange={(e) => setBusinessCode(e.target.value.toUpperCase())}
                placeholder="Business code (e.g. K7M2XQ)"
                maxLength={6}
                className={cn(inputCls, "font-mono tracking-[0.3em] text-center uppercase")}
              />

              {/* PIN dots */}
              <div className="flex justify-center gap-2.5 py-1">
                {Array.from({ length: KEYPAD_MAX }).map((_, i) => (
                  <span
                    key={i}
                    className={cn(
                      "w-3.5 h-3.5 rounded-full border-2 transition-colors",
                      i < pin.length ? "bg-primary border-primary" : "border-line-2"
                    )}
                  />
                ))}
              </div>

              {/* Numeric keypad */}
              <div className="grid grid-cols-3 gap-2">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => pressDigit(d)}
                    className="h-12 rounded-ctl bg-surface-2 border border-line-2 text-[17px] font-semibold text-t1 hover:bg-surface-3 active:scale-95 transition-all"
                  >
                    {d}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => { setError(""); setPin(""); }}
                  className="h-12 rounded-ctl bg-surface-2 border border-line-2 text-[11px] font-medium text-t3 hover:bg-surface-3 active:scale-95 transition-all"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => pressDigit("0")}
                  className="h-12 rounded-ctl bg-surface-2 border border-line-2 text-[17px] font-semibold text-t1 hover:bg-surface-3 active:scale-95 transition-all"
                >
                  0
                </button>
                <button
                  type="button"
                  onClick={() => { setError(""); setPin((p) => p.slice(0, -1)); }}
                  className="h-12 rounded-ctl bg-surface-2 border border-line-2 flex items-center justify-center text-t3 hover:bg-surface-3 active:scale-95 transition-all"
                  aria-label="Backspace"
                >
                  <Delete className="w-[18px] h-[18px]" />
                </button>
              </div>

              <Button type="submit" size="lg" className="w-full mt-2" disabled={busy || pin.length < KEYPAD_MAX}>
                <KeyRound className="w-4 h-4" /> {busy ? "Signing in…" : "Sign in with PIN"}
              </Button>
              <p className="text-[11px] text-t4 text-center">Ask your manager for the business code and your PIN.</p>
            </>
          )}
        </form>

        <div className="mt-6 text-[13px] text-t3">
          New to StarTrack?{" "}
          <Link to="/register" className="text-primary font-semibold hover:underline">Create your business</Link>
        </div>

        <p className="text-[11px] text-t4 mt-6 font-mono">StarTrack · Business OS</p>
      </div>
      <ForgotPassword open={forgot} initialEmail={email} onClose={() => setForgot(false)} onDone={(e) => { setEmail(e); setPassword(""); setError(""); setForgot(false); }} />
    </div>
  );
}

import { useState } from "react";
import { LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import { login, type AdminSession } from "@/services/auth";

export default function LoginScreen({ onSuccess }: { onSuccess: (s: AdminSession) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const s = await login(email, password);
      onSuccess(s);
    } catch (ex) {
      const msg = ex instanceof Error ? ex.message : "login_failed";
      if (msg === "invalid_credentials") setErr("Неверный email или пароль");
      else if (msg === "rate_limited") setErr("Слишком много попыток. Попробуйте через минуту.");
      else setErr("Не удалось войти. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 relative">
      <div className="absolute inset-0 -z-10 bg-grain opacity-[0.06] pointer-events-none" />
      <div className="w-full max-w-md panel p-8 relative">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-9 h-9 rounded-lg bg-gold-300/15 border border-gold-300/30 flex items-center justify-center">
            <LockKeyhole className="w-4 h-4 text-gold-300" />
          </div>
          <span className="text-xs uppercase tracking-[0.18em] text-ink-400">Restricted</span>
        </div>
        <h1 className="display-title text-3xl text-ink-100 mt-3">
          Командный центр<br />
          <span className="text-gold-300">Шашки Рояль</span>
        </h1>
        <p className="text-sm text-ink-400 mt-3 leading-relaxed">
          Введите email и пароль владельца. Сессия защищена HttpOnly-куки.
        </p>
        <form onSubmit={submit} className="mt-6 space-y-3" data-testid="login-form">
          <div className="relative">
            <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-500 pointer-events-none" />
            <input
              autoFocus
              type="email"
              placeholder="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              className="w-full pl-10 pr-4 py-3 rounded-xl bg-ink-800/70 border border-white/[0.06] focus:border-gold-300/50 focus:outline-none text-ink-100 placeholder:text-ink-500 mono text-sm"
              data-testid="login-email"
            />
          </div>
          <div className="relative">
            <LockKeyhole className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-500 pointer-events-none" />
            <input
              type="password"
              placeholder="пароль"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="w-full pl-10 pr-4 py-3 rounded-xl bg-ink-800/70 border border-white/[0.06] focus:border-gold-300/50 focus:outline-none text-ink-100 placeholder:text-ink-500 mono text-sm"
              data-testid="login-password"
            />
          </div>
          <button type="submit" disabled={busy} className="btn-gold w-full justify-center py-3 disabled:opacity-60 disabled:cursor-not-allowed" data-testid="login-submit">
            {busy ? "входим…" : "Войти"}
          </button>
          {err && <div className="text-xs text-accent-rose/90 px-1 pt-1 mono" data-testid="login-error">{err}</div>}
        </form>
        <div className="mt-7 pt-5 border-t border-white/[0.05] flex items-start gap-3 text-[12px] text-ink-400 leading-relaxed">
          <ShieldCheck className="w-4 h-4 text-accent-mint mt-0.5 shrink-0" />
          <span>
            Сервер: Cloudflare Pages Function · пароль защищён PBKDF2-SHA256 ·
            JWT в <span className="mono text-ink-300">HttpOnly</span> cookie ·
            service_role хранится только на сервере.
          </span>
        </div>
      </div>
    </div>
  );
}

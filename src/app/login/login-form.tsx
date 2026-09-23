"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowRight, Eye, EyeOff, Loader2 } from "lucide-react";
import { login } from "@/actions/auth";
import { usePrefs } from "@/components/providers";

export function LoginForm({ next }: { next: string }) {
  const { t } = usePrefs();
  const [error, setError] = useState<string | null>(null);
  // Submitted from a transition: with <form action={…}> React stopped dispatching after a
  // rejected attempt, so retyping the right password did nothing until a page reload.
  const [pending, start] = useTransition();
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (pending) return;
        const data = new FormData(e.currentTarget);
        start(async () => {
          const r = await login(null, data);
          if (r && !r.ok) setError(r.error);
        });
      }}
      className="mt-8 space-y-4"
    >
      <input type="hidden" name="next" value={next} />
      <div>
        <label className="label" htmlFor="email">{t("Email")}</label>
        <input id="email" name="email" type="email" autoComplete="username" required className="input" placeholder="you@company.com" />
      </div>
      <div>
        <div className="flex items-baseline justify-between">
          <label className="label" htmlFor="password">{t("Password")}</label>
          <Link href="/forgot" className="text-xs text-accent">{t("Forgot password?")}</Link>
        </div>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={show ? "text" : "password"}
            autoComplete="current-password"
            required
            className="input pe-10"
            onKeyUp={(e) => setCaps(e.getModifierState("CapsLock"))}
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute end-2 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-ink"
            aria-label={show ? "Hide password" : "Show password"}
            title={show ? "Hide password" : "Show password"}
          >
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        {caps && <p className="mt-1 text-xs text-warn">Caps Lock is on</p>}
      </div>
      {error && <p className="rounded-xl border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{t(error)}</p>}
      <button type="submit" className="btn btn-primary w-full py-2.5" disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <>{t("Sign in")} <ArrowRight className="size-4 rtl:rotate-180" /></>}
      </button>
    </form>
  );
}

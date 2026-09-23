"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Eye, EyeOff, KeyRound, Loader2, RefreshCw, X } from "lucide-react";
import { revealPassword, setPasswordByAdmin } from "@/actions/admin";
import { usePrefs } from "@/components/providers";
import { Portal } from "@/components/portal";

function when(ts: number | null | undefined) {
  return ts ? new Date(ts).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : null;
}

/** Masked password with an audited "show" toggle. */
export function PasswordCell({ userId, setBy, changedAt, enabled = true }: { userId: number; setBy: string | null; changedAt: number | null; enabled?: boolean }) {
  const { toast } = usePrefs();
  const [shown, setShown] = useState<string | null | undefined>(undefined);
  const [pending, start] = useTransition();

  const toggle = () => {
    if (shown !== undefined) return setShown(undefined);
    start(async () => {
      const r = await revealPassword(userId);
      if (!r.ok) toast(r.error ?? "Failed", "error");
      else setShown(r.password ?? null);
    });
  };

  if (!enabled) {
    return (
      <div className="min-w-40 text-xs text-muted">
        Hidden
        <div className="text-[10px]">Password viewing is off in Settings</div>
      </div>
    );
  }

  return (
    <div className="min-w-40">
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-xs text-ink">
          {shown === undefined ? "••••••••" : shown === null ? <span className="font-sans text-muted">Not available</span> : shown}
        </span>
        <button type="button" onClick={toggle} className="rounded p-1 text-muted hover:text-ink" title={shown === undefined ? "Show password" : "Hide"} aria-label="Show password">
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : shown === undefined ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
        </button>
        {shown && (
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(shown).then(() => toast("Password copied"))}
            className="rounded p-1 text-muted hover:text-ink"
            title="Copy"
            aria-label="Copy password"
          >
            <Copy className="size-3.5" />
          </button>
        )}
      </div>
      {shown === null && <div className="text-[10px] text-muted">Shown after their next login or password update</div>}
      {(setBy || changedAt) && (
        <div className="text-[10px] text-muted">
          {setBy}
          {changedAt ? ` · ${when(changedAt)}` : ""}
        </div>
      )}
    </div>
  );
}

/** "Update password" dialog for admins. Empty = generate a secure temporary password. */
export function SetPasswordButton({ userId, name, label }: { userId: number; name: string; label?: string }) {
  const { toast } = usePrefs();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [visible, setVisible] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const close = () => {
    setOpen(false);
    setValue("");
    setResult(null);
  };

  return (
    <>
      <button
        type="button"
        className={label ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"}
        onClick={() => setOpen(true)}
        title="Update password"
        aria-label="Update password"
      >
        <KeyRound className="size-3.5" /> {label}
      </button>
      {open && (
        <Portal>
          <div className="fixed inset-0 z-[80] grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={close}>
            <div className="card rise w-full max-w-sm p-5 text-start shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-ink">Update password</h3>
                  <p className="text-xs text-muted">{name}</p>
                </div>
                <button type="button" onClick={close} aria-label="Close">
                  <X className="size-4 text-muted" />
                </button>
              </div>

              {result ? (
                <div className="space-y-3">
                  <p className="text-sm text-ink-2">New password — share it with the employee:</p>
                  <div className="flex items-center gap-2 rounded-xl border border-good/30 bg-good/10 px-3 py-2.5">
                    <span className="flex-1 font-mono text-base text-ink">{result}</span>
                    <button type="button" onClick={() => navigator.clipboard?.writeText(result).then(() => toast("Password copied"))} aria-label="Copy">
                      <Copy className="size-4 text-good" />
                    </button>
                  </div>
                  <p className="text-xs text-muted">They have been signed out and must log in with this password.</p>
                  <button type="button" className="btn btn-primary w-full" onClick={close}>
                    Done
                  </button>
                </div>
              ) : (
                <form
                  className="space-y-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    start(async () => {
                      const r = await setPasswordByAdmin(userId, value);
                      if (!r.ok) return toast(r.error, "error");
                      setResult(r.password ?? value);
                      toast(r.message ?? "Password updated");
                      router.refresh();
                    });
                  }}
                >
                  <label className="block">
                    <span className="label">New password</span>
                    <div className="relative">
                      <input
                        type={visible ? "text" : "password"}
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        minLength={value ? 8 : undefined}
                        placeholder="Leave empty to generate one"
                        className="input pe-10 font-mono"
                        autoComplete="new-password"
                      />
                      <button type="button" onClick={() => setVisible((v) => !v)} className="absolute end-2 top-1/2 -translate-y-1/2 p-1 text-muted" aria-label="Toggle visibility">
                        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </button>
                    </div>
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn btn-ghost flex-1"
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          const r = await setPasswordByAdmin(userId, "");
                          if (!r.ok) return toast(r.error, "error");
                          setResult(r.password ?? null);
                          router.refresh();
                        })
                      }
                    >
                      <RefreshCw className="size-4" /> Generate
                    </button>
                    <button type="submit" className="btn btn-primary flex-1" disabled={pending}>
                      {pending ? <Loader2 className="size-4 animate-spin" /> : "Update"}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </Portal>
      )}
    </>
  );
}

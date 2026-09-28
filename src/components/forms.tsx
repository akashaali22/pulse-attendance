"use client";

import { createContext, useContext, useId, useRef, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import clsx from "clsx";
import type { ActionResult } from "@/lib/notify";
import { usePrefs } from "./providers";
import { Dialog } from "./dialog";

/** Form bound to a server action; toasts the result and resets on success. */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = true,
  onSuccess,
}: {
  action: (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  onSuccess?: () => void;
}) {
  const { t, toast } = usePrefs();
  const ref = useRef<HTMLFormElement>(null);
  const router = useRouter();
  // Dispatched from a transition rather than <form action={…}>: after a result that does not
  // refresh the router, React stops dispatching further submits, so a retry after an error
  // (a mistyped password, say) silently did nothing until the page was reloaded.
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending) return;
    const form = e.currentTarget;
    const data = new FormData(form);
    start(async () => {
      const state = await action(null, data);
      if (state.ok) {
        if (state.message && /password:/i.test(state.message)) window.alert(state.message);
        else toast(t(state.message ?? "Saved successfully"));
        if (resetOnSuccess) ref.current?.reset();
        onSuccess?.();
        router.refresh();
      } else toast(t(state.error), "error");
    });
  };

  return (
    <form ref={ref} onSubmit={submit} className={className}>
      <PendingContext.Provider value={pending}>{children}</PendingContext.Provider>
    </form>
  );
}

/** Lets SubmitButton show the in-flight state of the ActionForm around it. */
const PendingContext = createContext(false);

export function SubmitButton({ children, className, pendingText }: { children: React.ReactNode; className?: string; pendingText?: string }) {
  const formPending = useFormStatus().pending;
  const pending = useContext(PendingContext) || formPending;
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={clsx("btn btn-primary relative", className)}>
      <span className={clsx("inline-flex items-center gap-2", pending && "opacity-0")}>{children}</span>
      {pending && <span className="absolute inset-0 flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" />{pendingText}</span>}
    </button>
  );
}

export function ActionButton({
  run,
  children,
  className = "btn btn-ghost btn-sm",
  confirm,
  promptNote,
  title,
}: {
  run: (note: string) => Promise<ActionResult>;
  children: React.ReactNode;
  className?: string;
  confirm?: string;
  promptNote?: string;
  title?: string;
}) {
  const { t, toast } = usePrefs();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [ask, setAsk] = useState(false);
  const [note, setNote] = useState("");
  const execute = () => start(async () => {
    const r = await run(note);
    if (r.ok && r.message && /password:/i.test(r.message)) window.alert(r.message);
    else if (r.ok) toast(t(r.message ?? "Saved successfully"));
    else toast(t(r.error), "error");
    if (r.ok) { setAsk(false); setNote(""); }
    router.refresh();
  });
  return <>
    <button type="button" title={title} aria-label={title ?? (confirm ? t(confirm) : promptNote ? t(promptNote) : undefined)} disabled={pending} aria-busy={pending} className={clsx(className, "relative")} onClick={() => { if (confirm || promptNote) { setNote(""); setAsk(true); } else execute(); }}>
      <span className={clsx("inline-flex items-center gap-1.5", pending && "opacity-0")}>{children}</span>
      {pending && <Loader2 className="absolute size-3.5 animate-spin" />}
    </button>
    {ask && <Dialog label={t(promptNote ?? confirm ?? "Confirm")} onClose={() => { if (!pending) setAsk(false); }} className="max-w-md p-6">
      <form onSubmit={e => { e.preventDefault(); if (!pending) execute(); }}>
        <h2 className="text-lg font-semibold">{t(promptNote ?? confirm ?? "Confirm")}</h2>
        {promptNote && <label className="mt-4 block"><span className="label">{t(promptNote)}</span><textarea className="input min-h-24" value={note} onChange={e => setNote(e.target.value)} autoFocus /></label>}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => setAsk(false)}>{t("Cancel")}</button>
          <button type="submit" className="btn btn-primary" disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}{t("Confirm")}</button>
        </div>
      </form>
    </Dialog>}
  </>;
}

export function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  const { t } = usePrefs();
  return (
    <label className={clsx("block", className)}>
      <span className="label">{t(label)}</span>
      {children}
    </label>
  );
}

/** Small client-side tab switcher; panels stay mounted so forms keep their state. */
export function Tabs({ tabs }: { tabs: { id: string; label: string; content: React.ReactNode }[] }) {
  const { t } = usePrefs();
  const [active, setActive] = useState(tabs[0]?.id);
  const id = useId();
  const { lang } = usePrefs();
  return (
    <div>
      <div role="tablist" aria-label={t("Settings")} className="tabs-list mb-5 flex overflow-x-auto p-1">
        {tabs.map((tb) => (
          <button
            key={tb.id}
            id={`${id}-${tb.id}-tab`} role="tab" aria-selected={active === tb.id} aria-controls={`${id}-${tb.id}-panel`} tabIndex={active === tb.id ? 0 : -1}
            onKeyDown={e => {
              const direction = lang === "ur" ? -1 : 1;
              const delta = e.key === "ArrowRight" ? direction : e.key === "ArrowLeft" ? -direction : 0;
              if (!delta && e.key !== "Home" && e.key !== "End") return;
              e.preventDefault();
              const next = e.key === "Home" ? tabs[0] : e.key === "End" ? tabs[tabs.length - 1] : tabs[(tabs.findIndex(x => x.id === active) + delta + tabs.length) % tabs.length];
              setActive(next.id); document.getElementById(`${id}-${next.id}-tab`)?.focus();
            }}
            type="button"
            onClick={() => setActive(tb.id)}
            className={clsx(
              "whitespace-nowrap rounded-xl px-4 py-2 text-sm font-medium transition",
              active === tb.id ? "bg-accent-soft text-ink" : "text-muted hover:text-ink",
            )}
          >
            {t(tb.label)}
          </button>
        ))}
      </div>
      {tabs.map((tb) => (
        <div key={tb.id} id={`${id}-${tb.id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tb.id}-tab`} className="tab-panel" hidden={tb.id !== active}>
          {tb.content}
        </div>
      ))}
    </div>
  );
}

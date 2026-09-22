"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import clsx from "clsx";
import type { ActionResult } from "@/lib/notify";
import { usePrefs } from "./providers";

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
  const [state, formAction] = useActionState(action, null);
  const router = useRouter();
  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      if (state.message && /password:/i.test(state.message)) window.alert(state.message);
      else toast(t(state.message ?? "Saved successfully"));
      if (resetOnSuccess) ref.current?.reset();
      onSuccess?.();
      router.refresh();
    } else toast(t(state.error), "error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
    </form>
  );
}

export function SubmitButton({ children, className, pendingText }: { children: React.ReactNode; className?: string; pendingText?: string }) {
  return <PendingAware className={className} pendingText={pendingText}>{children}</PendingAware>;
}

function PendingAware({ children, className, pendingText }: { children: React.ReactNode; className?: string; pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={clsx("btn btn-primary", className)}>
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" /> {pendingText}
        </>
      ) : (
        children
      )}
    </button>
  );
}

/** Button that runs a server action with optional confirm + prompt for a note. */
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
  return (
    <button
      type="button"
      title={title}
      disabled={pending}
      className={className}
      onClick={() => {
        let note = "";
        if (promptNote) {
          const v = window.prompt(t(promptNote));
          if (v === null) return;
          note = v;
        } else if (confirm && !window.confirm(t(confirm))) return;
        start(async () => {
          const r = await run(note);
          if (r.ok && r.message && /password:/i.test(r.message)) window.alert(r.message);
          else if (r.ok) toast(t(r.message ?? "Saved successfully"));
          else toast(t(r.error), "error");
          router.refresh();
        });
      }}
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : children}
    </button>
  );
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
  return (
    <div>
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-2xl border border-line bg-surface p-1">
        {tabs.map((tb) => (
          <button
            key={tb.id}
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
        <div key={tb.id} hidden={tb.id !== active}>
          {tb.content}
        </div>
      ))}
    </div>
  );
}

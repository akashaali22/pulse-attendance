"use client";

import { createContext, useCallback, useContext, useMemo, useState, useEffect, useRef } from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";
import { translator, type Lang, type T } from "@/lib/i18n";

interface Toast {
  id: number;
  kind: "ok" | "error" | "warning" | "info";
  text: string;
}

interface Ctx {
  lang: Lang;
  theme: "dark" | "light";
  t: T;
  toast: (text: string, kind?: Toast["kind"]) => void;
}

const PrefCtx = createContext<Ctx | null>(null);

export function Providers({ lang, theme, children }: { lang: Lang; theme: "dark" | "light"; children: React.ReactNode }) {
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => { const active = timers.current; return () => { active.forEach(clearTimeout); }; }, []);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toast = useCallback((text: string, kind: Toast["kind"] = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((ts) => [...ts, { id, kind, text }]);
    const timer = setTimeout(() => { setToasts((ts) => ts.filter((x) => x.id !== id)); timers.current.delete(timer); }, 4200);
    timers.current.add(timer);
  }, []);
  const value = useMemo(() => ({ lang, theme, t: translator(lang), toast }), [lang, theme, toast]);

  return (
    <PrefCtx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 end-4 z-[100] flex w-[min(92vw,360px)] flex-col gap-2" aria-live="polite">
        {toasts.map((x) => (
          <div key={x.id} data-kind={x.kind} className="toast-item glass rise pointer-events-auto flex items-start gap-3 rounded-2xl px-4 py-3 text-sm shadow-2xl">
            {x.kind === "ok" ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-good" />
            ) : x.kind === "info" ? <Info className="mt-0.5 size-4 shrink-0 text-info" /> : (
              <AlertTriangle className={`mt-0.5 size-4 shrink-0 ${x.kind === "warning" ? "text-warn" : "text-bad"}`} />
            )}
            <span className="flex-1 text-ink">{x.text}</span>
            <button onClick={() => setToasts((ts) => ts.filter((y) => y.id !== x.id))} aria-label={value.t("Dismiss")}>
              <X className="size-4 text-muted" />
            </button>
          </div>
        ))}
      </div>
    </PrefCtx.Provider>
  );
}

export function usePrefs() {
  const c = useContext(PrefCtx);
  if (!c) throw new Error("usePrefs outside Providers");
  return c;
}

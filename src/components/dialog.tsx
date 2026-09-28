"use client";

import { useEffect, useRef } from "react";
import { Portal } from "./portal";

/** Shared keyboard and focus behavior for modal surfaces. */
export function Dialog({ children, label, onClose, className = "", drawer = false }: {
  children: React.ReactNode; label: string; onClose: () => void; className?: string; drawer?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => {
      if (ref.current?.contains(document.activeElement)) return;
      (ref.current?.querySelector<HTMLElement>("input:not(:disabled):not([type=hidden]), textarea:not(:disabled), select:not(:disabled), button:not(:disabled), a[href], [tabindex='0']") ?? ref.current)?.focus();
    });
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close.current(); }
      if (e.key !== "Tab") return;
      const nodes = Array.from(ref.current?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled):not([type=hidden]), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? []).filter(el => el.tabIndex >= 0 && el.getClientRects().length);
      const first = nodes[0], last = nodes.at(-1);
      if (!first) { e.preventDefault(); ref.current?.focus(); return; }
      if (!ref.current?.contains(document.activeElement)) { e.preventDefault(); (e.shiftKey ? last : first)?.focus(); return; }
      if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", key, true);
    return () => { cancelAnimationFrame(frame); document.body.style.overflow = overflow; document.removeEventListener("keydown", key, true); previous?.focus(); };
  }, []);
  return <Portal><div className={`dialog-backdrop ${drawer ? "dialog-drawer" : ""}`} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div ref={ref} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} className={`dialog-surface ${className}`}>{children}</div>
  </div></Portal>;
}

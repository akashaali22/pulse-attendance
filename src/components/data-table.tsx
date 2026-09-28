"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { usePrefs } from "./providers";

/** Progressively enhances server-rendered tables without serializing actions or duplicating rows. */
export function DataTable({ children }: { children: React.ReactNode }) {
  const { t } = usePrefs();
  const ref = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [count, setCount] = useState<number | null>(null);
  const size = 15;
  useEffect(() => {
    const rows = Array.from(ref.current?.querySelectorAll<HTMLTableRowElement>("tbody > tr") ?? []);
    const matches = rows.filter(row => (row.textContent ?? "").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
    const current = Math.min(page, Math.max(0, Math.ceil(matches.length / size) - 1));
    const visible = new Set(matches.slice(current * size, (current + 1) * size));
    rows.forEach(row => { row.hidden = !visible.has(row); });
    setCount(matches.length);
    if (current !== page) setPage(current);
  }, [children, query, page]);
  return <div>
    <div className="table-tools">
      <label className="relative flex-1">
        <Search aria-hidden className="absolute start-3 top-3 size-4 text-muted" />
        <input className="input text-xs" type="search" aria-label={t("Search this table")} placeholder={t("Search this table")} value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} />
      </label>
      <span className="text-xs text-muted tabular" aria-live="polite">{count === null ? "—" : count} {t("records")}</span>
      {query && <button className="btn btn-ghost btn-sm" onClick={() => setQuery("")} aria-label={t("Clear search")}><X className="size-3.5" /></button>}
    </div>
    <div ref={ref} className="table-scroll" tabIndex={0} role="region" aria-label={t("Data table")}>{children}</div>
    {count === 0 && <div className="empty-state"><Search className="size-5 text-muted" /><p>{t("No matching records")}</p>{query && <button className="btn btn-ghost btn-sm" onClick={() => setQuery("")}>{t("Clear search")}</button>}</div>}
    {count !== null && count > size && <div className="table-footer">
      <span className="tabular">{page * size + 1}–{Math.min(count, (page + 1) * size)} / {count}</span>
      <div className="flex items-center gap-2">
        <button className="btn btn-ghost btn-sm" disabled={page === 0} aria-label={t("Previous page")} onClick={() => setPage(p => p - 1)}><ChevronLeft className="size-4 rtl:rotate-180" /></button>
        <span className="tabular">{page + 1} / {Math.ceil(count / size)}</span>
        <button className="btn btn-ghost btn-sm" disabled={(page + 1) * size >= count} aria-label={t("Next page")} onClick={() => setPage(p => p + 1)}><ChevronRight className="size-4 rtl:rotate-180" /></button>
      </div>
    </div>}
  </div>;
}

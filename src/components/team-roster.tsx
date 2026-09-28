"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, LayoutGrid, List, Search } from "lucide-react";
import type { DayStatus } from "@/lib/engine";
import { Avatar, Empty, StatusBadge } from "./ui";
import { usePrefs } from "./providers";

export interface RosterPerson {
  id: number; name: string; code: string; department: string; status: DayStatus;
  worked: string; firstIn: string; sources: string; href: string; action: React.ReactNode;
}

export function TeamRoster({ people, children }: { people: RosterPerson[]; children: React.ReactNode }) {
  const { t } = usePrefs();
  const [view, setView] = useState("grid");
  const [query, setQuery] = useState("");
  const visible = people.filter(person => `${person.name} ${person.code} ${person.department}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <div className="roster">
    <div className="roster-toolbar">
      {view === "grid" ? <label className="relative w-full max-w-xs"><Search className="absolute start-3 top-3 size-4 text-muted" /><input type="search" className="input ps-9" aria-label={t("Search team")} placeholder={t("Search team")} value={query} onChange={e => setQuery(e.target.value)} /></label> : <span className="text-sm text-muted">{t("Attendance register")}</span>}
      <div className="view-switch" role="group" aria-label={t("View")}>
        <button aria-pressed={view === "grid"} onClick={() => setView("grid")}><LayoutGrid className="size-4" />{t("Roster")}</button>
        <button aria-pressed={view === "table"} onClick={() => setView("table")}><List className="size-4" />{t("Details")}</button>
      </div>
    </div>
    {view === "grid" && <div className="roster-grid">
      {visible.map(person => <article className="person-card" key={person.id} data-status={person.status}>
        <div className="flex items-start justify-between gap-3"><Avatar name={person.name} size="size-11" /><StatusBadge status={person.status} label={t(person.status)} /></div>
        <Link className="person-name" href={person.href}>{person.name}<ArrowUpRight className="size-4 rtl:-scale-x-100" /></Link>
        <p className="text-xs text-muted">{person.department} · {person.code}</p>
        <dl className="person-timing"><div><dt>{t("Worked")}</dt><dd>{person.worked}</dd></div><div><dt>{t("First in")}</dt><dd>{person.firstIn}</dd></div></dl>
        <div className="person-footer"><span>{person.sources || t("NOT_STARTED")}</span>{person.action}</div>
      </article>)}
      {!visible.length && <div className="col-span-full card"><Empty text={t("No matching records")} /></div>}
    </div>}
    <div hidden={view !== "table"}>{children}</div>
  </div>;
}

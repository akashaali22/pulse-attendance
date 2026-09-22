import Link from "next/link";
import type { Metadata } from "next";
import { ShieldCheck, ShieldX } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { verifyAuditChain } from "@/lib/audit";
import { getTz } from "@/lib/data";
import { getPrefs } from "@/lib/prefs";
import { Card, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Audit Log" };
export const dynamic = "force-dynamic";

const PAGE = 50;

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ page?: string; q?: string }> }) {
  await requireUser(["admin"]);
  const { t } = await getPrefs();
  const tz = getTz();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const q = (sp.q ?? "").trim();
  const like = `%${q}%`;
  const rows = all<{ id: number; ts: number; actor: string | null; action: string; entity: string; entity_id: string | null; details: string | null; hash: string }>(
    `SELECT a.id, a.ts, u.name AS actor, a.action, a.entity, a.entity_id, a.details, a.hash
     FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
     WHERE (? = '' OR a.action LIKE ? OR a.entity LIKE ? OR u.name LIKE ? OR a.details LIKE ?)
     ORDER BY a.id DESC LIMIT ? OFFSET ?`,
    q,
    like,
    like,
    like,
    like,
    PAGE + 1,
    (page - 1) * PAGE,
  );
  const hasMore = rows.length > PAGE;
  const chain = verifyAuditChain();
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: tz, dateStyle: "medium", timeStyle: "medium" });

  return (
    <>
      <PageHeader title={t("Audit Log")} subtitle="Append-only, SHA-256 hash-chained record of every change">
        <form className="flex gap-2">
          <input name="q" defaultValue={q} placeholder={`${t("Search")}…`} className="input w-56" />
          <button className="btn btn-ghost">{t("Filter")}</button>
        </form>
      </PageHeader>

      <div className={`card mb-4 flex items-center gap-4 p-5 ${chain.ok ? "border-good/30" : "border-bad/40"}`}>
        {chain.ok ? <ShieldCheck className="size-8 text-good" /> : <ShieldX className="size-8 text-bad" />}
        <div>
          <div className="font-semibold">{chain.ok ? "Integrity verified" : "Integrity check FAILED"}</div>
          <div className="text-sm text-muted">
            {chain.ok
              ? `All ${chain.checked} entries link correctly — no entry has been altered or removed.`
              : `The chain breaks at entry #${chain.brokenAt}. Records from that point may have been tampered with.`}
          </div>
        </div>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="data">
            <thead>
              <tr>
                <th>#</th>
                <th>Time</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Details</th>
                <th>Hash</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, PAGE).map((r) => (
                <tr key={r.id}>
                  <td className="text-muted tabular">{r.id}</td>
                  <td className="whitespace-nowrap tabular">{fmt.format(new Date(r.ts))}</td>
                  <td className="text-ink">{r.actor ?? "—"}</td>
                  <td><span className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-ink">{r.action}</span></td>
                  <td className="whitespace-nowrap">{r.entity}{r.entity_id ? ` #${r.entity_id}` : ""}</td>
                  <td className="max-w-80"><div className="truncate font-mono text-[11px]" title={r.details ?? ""}>{r.details ?? ""}</div></td>
                  <td className="font-mono text-[11px] text-muted" title={r.hash}>{r.hash.slice(0, 10)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-between border-t border-line px-5 py-3 text-sm">
          {page > 1 ? <Link className="text-accent" href={`/audit?page=${page - 1}&q=${encodeURIComponent(q)}`}>← Newer</Link> : <span />}
          {hasMore && <Link className="text-accent" href={`/audit?page=${page + 1}&q=${encodeURIComponent(q)}`}>Older →</Link>}
        </div>
      </Card>
    </>
  );
}

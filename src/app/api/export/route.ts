import ExcelJS from "exceljs";
import { getUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { buildReport, parseReportParams, summaryRows } from "@/lib/report";

export const dynamic = "force-dynamic";

function csvCell(v: unknown): string {
  let s = String(v ?? "");
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: Request) {
  const me = await getUser();
  if (!me || me.role === "employee") return new Response("Forbidden", { status: 403 });

  const url = new URL(req.url);
  const sp = Object.fromEntries(url.searchParams) as Record<string, string>;
  const params = parseReportParams(sp);
  const kind = sp.kind === "daily" ? "daily" : "summary";
  const format = sp.format === "xlsx" ? "xlsx" : "csv";
  const report = buildReport(me, params);
  const rows: Record<string, unknown>[] = kind === "daily" ? report.daily : summaryRows(report);
  const name = `attendance-${kind}-${params.from}_to_${params.to}`;
  audit(me.id, "REPORT_EXPORTED", "report", null, { ...params, kind, format, rows: rows.length });

  const headers = rows.length ? Object.keys(rows[0]) : ["no_data"];
  if (format === "csv") {
    const body = "﻿" + [headers.join(","), ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(","))].join("\r\n");
    return new Response(body, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"` },
    });
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "Pulse Attendance";
  const ws = wb.addWorksheet(kind === "daily" ? "Daily register" : "Summary", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = headers.map((h) => ({ header: h.replace(/_/g, " ").toUpperCase(), key: h, width: Math.max(12, h.length + 4) }));
  ws.addRows(rows);
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4F46E5" } };
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}.xlsx"`,
    },
  });
}

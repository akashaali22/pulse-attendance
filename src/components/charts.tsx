"use client";

import { useId, useState } from "react";
import clsx from "clsx";
import { usePrefs } from "./providers";
import { STATUS_STYLE } from "./ui";
import type { DayStatus } from "@/lib/engine";

import { SERIES, type TrendPoint } from "@/lib/chart-series";

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  const { t } = usePrefs();
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px]" style={{ background: i.color }} />
          {t(i.label)}
        </li>
      ))}
    </ul>
  );
}

const shortDate = (d: string) => {
  const [, m, day] = d.split("-").map(Number);
  return `${day}/${m}`;
};

/** Stacked daily headcount by status. Single y-scale, 2px gaps between segments, rounded top. */
export function TrendBars({ data, height = 220 }: { data: TrendPoint[]; height?: number }) {
  const { t } = usePrefs();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => SERIES.reduce((s, k) => s + d[k.key], 0)));
  const ticks = [...new Set([0, Math.round(max / 2), max])];
  const h = height;
  const pad = { top: 8, bottom: 24, left: 28 };
  const plotH = h - pad.top - pad.bottom;
  const colW = 100 / Math.max(1, data.length);

  return (
    <div className="relative" style={{ height: h }} onMouseLeave={() => setHover(null)}>
      {/* y grid */}
      {ticks.map((tk) => {
        const y = pad.top + plotH - (tk / max) * plotH;
        return (
          <div key={tk} className="absolute inset-x-0 flex items-center" style={{ top: y - 7 }}>
            <span className="w-6 text-end text-[10px] text-muted tabular">{tk}</span>
            <span className="ms-1 h-px flex-1" style={{ background: tk === 0 ? "var(--border-strong)" : "var(--grid)" }} />
          </div>
        );
      })}
      <div className="absolute flex" style={{ insetInlineStart: pad.left, insetInlineEnd: 0, top: pad.top, height: plotH }}>
        {data.map((d, i) => {
          let acc = 0;
          return (
            <div key={d.date} tabIndex={0} aria-label={`${d.date}: ${SERIES.map(s => `${t(s.label)} ${d[s.key]}`).join(", ")}`} onFocus={() => setHover(i)} onBlur={() => setHover(null)} onClick={() => setHover(i)} className="relative flex h-full flex-col-reverse items-center" style={{ width: `${colW}%` }} onMouseEnter={() => setHover(i)}>
              {hover === i && <div className="absolute inset-0 rounded-md bg-accent-soft" />}
              <div className="relative flex h-full w-[58%] max-w-7 flex-col-reverse gap-[2px]">
                {SERIES.map((s) => {
                  const v = d[s.key];
                  if (!v) return null;
                  acc += v;
                  const top = acc === SERIES.reduce((sum, k) => sum + d[k.key], 0);
                  return (
                    <div
                      key={s.key}
                      style={{ height: `calc(${(v / max) * 100}% - 2px)`, background: s.color }}
                      className={clsx("chart-bar w-full", top ? "rounded-t-[4px]" : "")}
                    />
                  );
                })}
              </div>
              <span className="absolute -bottom-5 text-[10px] text-muted tabular">{data.length <= 7 || i % Math.ceil(data.length / 7) === 0 ? shortDate(d.date) : ""}</span>
            </div>
          );
        })}
      </div>
      {hover !== null && data[hover] && (
        <div
          className="glass pointer-events-none absolute z-10 min-w-40 rounded-xl p-3 text-xs shadow-xl"
          style={{
            top: 0,
            insetInlineEnd: 0,
            maxWidth: "min(220px, 80%)",
          }}
        >
          <div className="mb-1.5 font-semibold text-ink">{data[hover].date}</div>
          {SERIES.map((s) => (
            <div key={s.key} className="flex items-center gap-2 py-0.5 text-ink-2">
              <span className="size-2 rounded-[2px]" style={{ background: s.color }} />
              <span className="flex-1">{t(s.label)}</span>
              <span className="font-semibold text-ink tabular">{data[hover][s.key]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Horizontal bars for a single measure (attendance % by department). */
export function RateBars({ rows }: { rows: { label: string; value: number; sub?: string }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  return (
    <ul className="space-y-3">
      {rows.map((r, i) => (
        <li key={r.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
          <div className="mb-1 flex items-baseline justify-between text-xs">
            <span className="font-medium text-ink-2">{r.label}</span>
            <span className="text-ink tabular">
              {r.value.toFixed(0)}%{hover === i && r.sub && <span className="ms-2 text-muted">{r.sub}</span>}
            </span>
          </div>
          <div className="h-2 rounded-full bg-surface-2">
            <div className="progress-fill h-full rounded-full" style={{ transform: `scaleX(${Math.max(0, Math.min(100, r.value)) / 100})`, background: "var(--accent)" }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Circular gauge for one headline percentage. */
export function Ring({ value, size = 120, label }: { value: number; size?: number; label?: string }) {
  const id = useId();
  const r = size / 2 - 8;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth="8" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#${id})`}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v / 100)}
          className="clock-progress"
        />
        <defs>
          <linearGradient id={id} x1="0" x2="1">
            <stop offset="0" stopColor="var(--accent)" />
            <stop offset="1" stopColor="var(--accent-2)" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute text-center">
        <div className="text-2xl font-semibold tabular">{v.toFixed(0)}%</div>
        {label && <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>}
      </div>
    </div>
  );
}

export interface HeatDay {
  date: string;
  status: DayStatus;
  late: boolean;
  worked: string;
  inOut: string;
}

/** Month calendar; each cell is status dot + label on hover so meaning never relies on color alone. */
export function MonthHeatmap({ days, weekStart = 1 }: { days: HeatDay[]; weekStart?: 0 | 1 }) {
  const { t } = usePrefs();
  const [hover, setHover] = useState<HeatDay | null>(null);
  const [selected, setSelected] = useState<HeatDay | null>(null);
  const active = days.find(day => day.date === (hover ?? selected)?.date);
  if (days.length === 0) return null;
  const [y, m] = days[0].date.split("-").map(Number);
  const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const lead = (firstDow - weekStart + 7) % 7;
  const names = weekStart === 1 ? ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] : ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  const fill: Partial<Record<DayStatus, string>> = {
    PRESENT: "var(--good)",
    WORKING: "var(--good)",
    HALF_DAY: "var(--serious)",
    ABSENT: "var(--bad)",
    INCOMPLETE: "var(--warn)",
    ON_BREAK: "var(--warn)",
    ON_LEAVE: "var(--info)",
    HOLIDAY: "var(--accent)",
  };
  return (
    <div key={days[0].date} className="rise">
      <div className="grid grid-cols-7 gap-1.5 text-center text-[10px] font-medium text-muted">
        {names.map((n) => (
          <div key={n}>{t(n)}</div>
        ))}
        {Array.from({ length: lead }).map((_, i) => (
          <div key={`l${i}`} />
        ))}
        {days.map((d) => {
          const bg = fill[d.status];
          return (
            <button
              type="button"
              key={d.date}
              onMouseEnter={() => setHover(d)}
              onFocus={() => setHover(d)}
              onBlur={() => setHover(null)}
              onClick={() => setSelected(v => v?.date === d.date ? null : d)}
              onKeyDown={event => { if (event.key === "Escape") { setSelected(null); setHover(null); } }}
              aria-pressed={selected?.date === d.date}
              onMouseLeave={() => setHover(null)}
              className={clsx(
                "heat-cell relative aspect-square border text-[11px] font-medium tabular",
                bg ? "border-transparent" : "border-line text-muted",
              )}
              style={bg ? { background: `color-mix(in srgb, ${bg} 14%, var(--surface))`, color: bg, borderColor: `color-mix(in srgb, ${bg} 25%, transparent)` } : undefined}
              aria-label={`${d.date}: ${t(d.status)}${d.late ? `, ${t("Late")}` : ""}, ${d.worked}`}
            >
              {Number(d.date.slice(8))}
              {d.late && <span className="absolute end-1 top-1 size-1.5 rounded-full bg-warn" />}
            </button>
          );
        })}
      </div>
      <div className="heat-detail text-xs" aria-live="polite">
        {active ? (
          <div className="flex flex-wrap items-center gap-2 text-ink-2">
            <span className="font-semibold text-ink">{active.date}</span>
            <span className={clsx("rounded-full border px-2 py-0.5", STATUS_STYLE[active.status].chip)}>{t(active.status)}</span>
            {active.late && <span className="text-warn">{t("Late")}</span>}
            <span>{active.inOut}</span>
            <span className="text-muted">· {active.worked}</span>
          </div>
        ) : <p className="text-muted">{t("Select a day to explore its timeline.")}</p>}
      </div>
      <div className="mt-3">
          <Legend
            items={[
              { label: "PRESENT", color: "var(--good)" },
              { label: "HALF_DAY", color: "var(--serious)" },
              { label: "ABSENT", color: "var(--bad)" },
              { label: "INCOMPLETE", color: "var(--warn)" },
              { label: "ON_LEAVE", color: "var(--info)" },
              { label: "HOLIDAY", color: "var(--accent)" },
            ]}
          />
      </div>
    </div>
  );
}

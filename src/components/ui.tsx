import clsx from "clsx";
import type { DayStatus } from "@/lib/engine";

export const STATUS_STYLE: Record<DayStatus | "pending" | "approved" | "rejected" | "cancelled", { dot: string; chip: string }> = {
  PRESENT: { dot: "bg-good", chip: "text-good bg-good/10 border-good/25" },
  WORKING: { dot: "bg-good live-dot", chip: "text-good bg-good/10 border-good/25" },
  HALF_DAY: { dot: "bg-serious", chip: "text-serious bg-serious/10 border-serious/25" },
  ABSENT: { dot: "bg-bad", chip: "text-bad bg-bad/10 border-bad/25" },
  INCOMPLETE: { dot: "bg-warn", chip: "text-warn bg-warn/10 border-warn/25" },
  ON_BREAK: { dot: "bg-warn", chip: "text-warn bg-warn/10 border-warn/25" },
  ON_LEAVE: { dot: "bg-info", chip: "text-info bg-info/10 border-info/25" },
  HOLIDAY: { dot: "bg-accent", chip: "text-accent bg-accent/10 border-accent/25" },
  WEEKEND: { dot: "bg-muted", chip: "text-muted bg-surface-2 border-line" },
  NOT_STARTED: { dot: "bg-muted", chip: "text-muted bg-surface-2 border-line" },
  UPCOMING: { dot: "bg-muted/50", chip: "text-muted bg-surface-2 border-line" },
  NOT_JOINED: { dot: "bg-muted/50", chip: "text-muted bg-surface-2 border-line" },
  pending: { dot: "bg-warn", chip: "text-warn bg-warn/10 border-warn/25" },
  approved: { dot: "bg-good", chip: "text-good bg-good/10 border-good/25" },
  rejected: { dot: "bg-bad", chip: "text-bad bg-bad/10 border-bad/25" },
  cancelled: { dot: "bg-muted", chip: "text-muted bg-surface-2 border-line" },
};

/** Status is always shown as dot + text label, never color alone. */
export function StatusBadge({ status, label }: { status: keyof typeof STATUS_STYLE; label: string }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.NOT_STARTED;
  return (
    <span className={clsx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium", s.chip)}>
      <span className={clsx("size-1.5 rounded-full", s.dot)} />
      {label}
    </span>
  );
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 rise">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  icon,
  tone = "accent",
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: "accent" | "good" | "warn" | "bad" | "info" | "serious";
  className?: string;
}) {
  const toneCls = { accent: "text-accent bg-accent/10", good: "text-good bg-good/10", warn: "text-warn bg-warn/10", bad: "text-bad bg-bad/10", info: "text-info bg-info/10", serious: "text-serious bg-serious/10" }[tone];
  return (
    <div className={clsx("card relative min-w-0 overflow-hidden p-4 sm:p-5 rise", className)}>
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 text-[11px] font-medium uppercase tracking-wider text-muted sm:text-xs">{label}</span>
        {icon && <span className={clsx("grid size-8 shrink-0 place-items-center rounded-lg", toneCls)}>{icon}</span>}
      </div>
      <div className="mt-3 truncate text-2xl font-semibold tracking-tight sm:text-3xl">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function Card({ title, action, children, className }: { title?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={clsx("card rise", className)}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Empty({ text }: { text: string }) {
  return <div className="px-5 py-12 text-center text-sm text-muted">{text}</div>;
}

export function Avatar({ name, size = "size-8" }: { name: string; size?: string }) {
  const initials = name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return (
    <span
      className={clsx(size, "grid shrink-0 place-items-center rounded-lg text-[11px] font-bold text-white")}
      style={{ background: `linear-gradient(135deg, oklch(0.62 0.15 ${h}), oklch(0.55 0.15 ${(h + 50) % 360}))` }}
    >
      {initials}
    </span>
  );
}

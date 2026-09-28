"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  Bell,
  CalendarDays,
  ClipboardCheck,
  Command,
  FileBarChart2,
  FileClock,
  Globe,
  LayoutDashboard,
  LogOut,
  Menu,
  MonitorSmartphone,
  Moon,
  Palmtree,
  QrCode,
  ScrollText,
  Search,
  Settings,
  Sun,
  UserRound,
  Users,
  Radio,
  X,
  CornerDownLeft,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import clsx from "clsx";
import { logout, setPreference } from "@/actions/auth";
import { markNotificationsRead } from "@/actions/admin";
import { usePrefs } from "./providers";
import { Logo } from "./logo";
import { Portal } from "./portal";
import { Dialog } from "./dialog";

export interface NavItem {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
  group: string;
  badge?: number;
}
export interface Notice {
  id: number;
  title: string;
  body: string | null;
  link: string | null;
  read: number;
  created_at: number;
}

const ICONS = {
  dashboard: LayoutDashboard,
  calendar: CalendarDays,
  leave: Palmtree,
  corrections: FileClock,
  team: Radio,
  approvals: ClipboardCheck,
  reports: FileBarChart2,
  qr: QrCode,
  employees: Users,
  apps: MonitorSmartphone,
  settings: Settings,
  audit: ScrollText,
  profile: UserRound,
};

function timeAgo(ts: number, now: number, lang: string) {
  const seconds = Math.max(0, Math.round((now - ts) / 1000));
  const fmt = new Intl.RelativeTimeFormat(lang === "ur" ? "ur-PK" : "en", { numeric: "auto", style: "short" });
  if (seconds < 60) return fmt.format(0, "second");
  if (seconds < 3600) return fmt.format(-Math.floor(seconds / 60), "minute");
  if (seconds < 86400) return fmt.format(-Math.floor(seconds / 3600), "hour");
  return fmt.format(-Math.floor(seconds / 86400), "day");
}

export function Shell({
  nav,
  notices,
  company,
  user,
  children,
}: {
  nav: NavItem[];
  notices: Notice[];
  company: string;
  user: { name: string; email: string; role: string; designation: string | null };
  children: React.ReactNode;
}) {
  const { t, theme, lang } = usePrefs();
  const path = usePathname();
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => { try { setCollapsed(localStorage.getItem("pulse-sidebar") === "compact"); } catch {} }, []);
  const collapse = () => { setCollapsed(v => { try { localStorage.setItem("pulse-sidebar", v ? "expanded" : "compact"); } catch {} return !v; }); };
  // "5m ago" depends on the current clock, which the server does not share — fill it in after mount.
  const [mountedAt, setMountedAt] = useState<number | null>(null);
  useEffect(() => setMountedAt(Date.now()), []);
  const [palette, setPalette] = useState(false);
  const [bell, setBell] = useState(false);
  const [, start] = useTransition();
  const unread = notices.filter((n) => !n.read).length;

  useEffect(() => setDrawer(false), [path]);

  // Live alerts (e.g. "Break started" at 1:15): poll for new notifications, show a toast and a system notification.
  const { toast } = usePrefs();
  const router = useRouter();
  const lastId = useRef(Math.max(0, ...notices.map((n) => n.id)));
  useEffect(() => {
    lastId.current = Math.max(lastId.current, ...notices.map((n) => n.id));
  }, [notices]);
  useEffect(() => {
    const askPermission = () => {
      if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {});
    };
    window.addEventListener("click", askPermission, { once: true });
    const id = setInterval(async () => {
      try {
        const r = await fetch(`/api/notifications?after=${lastId.current}`, { cache: "no-store" });
        if (!r.ok) return;
        const { items } = (await r.json()) as { items: { id: number; title: string; body: string | null }[] };
        if (!items.length) return;
        for (const n of items) {
          toast(n.title);
          if ("Notification" in window && Notification.permission === "granted") new Notification(n.title, { body: n.body ?? undefined, icon: "/icon.svg" });
        }
        lastId.current = Math.max(lastId.current, ...items.map((n) => n.id));
        router.refresh();
      } catch {
        /* offline — retry next tick */
      }
    }, 30_000);
    return () => {
      clearInterval(id);
      window.removeEventListener("click", askPermission);
    };
  }, [router, toast]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setDrawer(false);
        setPalette((p) => !p);
      }
      if (e.key === "Escape") {
        setPalette(false);
        setBell(false);
        setDrawer(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggleTheme = () => start(() => setPreference("theme", theme === "dark" ? "light" : "dark"));
  const toggleLang = () => start(() => setPreference("lang", lang === "ur" ? "en" : "ur"));

  const groups = [...new Set(nav.map((n) => n.group))];
  const initials = user.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();

  const sidebar = (
    <nav className="sidebar-nav flex h-full flex-col gap-6 p-4" aria-label={t("Workspace")}>
      <div className="sidebar-logo flex items-center gap-3 px-2 pt-1">
        <Logo />
        <div className="sidebar-copy min-w-0">
          <div className="sidebar-brand font-semibold leading-tight tracking-tight">Pulse</div>
          <div className="truncate text-xs text-muted">{company}</div>
        </div>
      </div>
      <button
        onClick={() => { setDrawer(false); setPalette(true); }}
        aria-label={t("Search")} className="sidebar-search flex items-center gap-2 border border-line px-3 py-2 text-muted transition hover:text-ink"
      >
        <Search className="size-4" />
        <span className="flex-1 text-start">{t("Search")}…</span>
        <kbd className="rounded-md border border-line px-1.5 font-mono text-[10px]">Ctrl K</kbd>
      </button>
      <div className="flex-1 space-y-6 overflow-y-auto">
        {groups.map((g) => (
          <div key={g}>
            <div className="group-label mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">{t(g)}</div>
            <ul className="space-y-0.5">
              {nav
                .filter((n) => n.group === g)
                .map((n) => {
                  const I = ICONS[n.icon];
                  const active = path === n.href || path.startsWith(n.href + "/");
                  return (
                    <li key={n.href}>
                      <Link
                        href={n.href}
                        aria-current={active ? "page" : undefined}
                        data-label={t(n.label)}
                        title={collapsed ? t(n.label) : undefined}
                        className={clsx(
                          "nav-link group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition",
                          active ? "bg-accent-soft font-semibold text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
                        )}
                      >
                        {active && <span className="absolute inset-y-2 start-0 w-[3px] rounded-full bg-accent" />}
                        <I className={clsx("size-[18px]", active ? "text-accent" : "text-muted group-hover:text-ink-2")} />
                        <span className="nav-label flex-1">{t(n.label)}</span>
                        {!!n.badge && (
                          <span className="nav-badge rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-bold text-white tabular">{n.badge}</span>
                        )}
                      </Link>
                    </li>
                  );
                })}
            </ul>
          </div>
        ))}
      </div>
      <Link href="/profile" className="sidebar-account flex items-center gap-3 rounded-xl border border-line p-2.5 transition hover:bg-surface-2">
        <div className="grid size-9 place-items-center rounded-lg bg-gradient-to-br from-accent/80 to-accent-2/80 text-xs font-bold text-white">{initials}</div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{user.name}</div>
          <div className="truncate text-xs capitalize text-muted">{user.designation ?? user.role}</div>
        </div>
      </Link>
      <button className="sidebar-collapse hidden lg:flex" onClick={collapse} aria-label={t(collapsed ? "Expand sidebar" : "Collapse sidebar")} aria-expanded={!collapsed}>{collapsed ? <PanelLeftOpen className="size-4 rtl:rotate-180" /> : <PanelLeftClose className="size-4 rtl:rotate-180" />}<span>{t("Collapse sidebar")}</span></button>
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      <a href="#main-content" className="skip-link">{t("Skip to content")}</a>
      <aside className={clsx("app-sidebar sticky top-0 z-50 hidden h-screen shrink-0 border-e border-line lg:block", collapsed && "sidebar-compact")}>{sidebar}</aside>

      {drawer && <Dialog label={t("Menu")} onClose={() => setDrawer(false)} drawer><button className="absolute end-3 top-3 z-10 rounded-md p-2" aria-label={t("Close")} onClick={() => setDrawer(false)}><X className="size-4" /></button>{sidebar}</Dialog>}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="app-topbar sticky top-0 z-40 flex h-16 items-center gap-2 border-x-0 border-t-0 px-4 sm:px-6">
          <button className="btn btn-ghost btn-sm lg:hidden" onClick={() => setDrawer(true)} aria-label={t("Menu")} aria-expanded={drawer}>
            <Menu className="size-4" />
          </button>
          <div className="topbar-context"><span>{t(nav.find(n => path === n.href || path.startsWith(n.href + "/"))?.group ?? "Workspace")}</span><span aria-hidden>/</span><strong>{t(nav.find(n => path === n.href || path.startsWith(n.href + "/"))?.label ?? "Profile")}</strong></div>
          <button className="topbar-search" onClick={() => { setDrawer(false); setPalette(true); }} aria-label={t("Search")}><Search className="size-4" /><span>{t("Search")}</span><kbd>Ctrl K</kbd></button>
          <button className="btn btn-ghost btn-sm" onClick={toggleLang} title={t("Language")} aria-label={lang === "ur" ? "English" : "اردو"}>
            <Globe className="size-4" />
            <span className="hidden sm:inline">{lang === "ur" ? "English" : "اردو"}</span>
          </button>
          <button className="btn btn-ghost btn-sm" onClick={toggleTheme} title={t("Theme")} aria-label={t("Theme")}>
            {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
          <div className="relative">
            <button className="btn btn-ghost btn-sm relative" onClick={() => setBell((b) => !b)} aria-label={t("Notifications")} aria-expanded={bell}>
              <Bell className="size-4" />
              {unread > 0 && (
                <span className="absolute -end-1 -top-1 grid min-w-4 place-items-center rounded-full bg-bad px-1 text-[10px] font-bold text-white">{unread}</span>
              )}
            </button>
            {bell && (
              <>
                <Portal>
                  <div className="fixed inset-0 z-30" onClick={() => setBell(false)} />
                </Portal>
                <div className="notice-panel glass rise z-50 overflow-hidden rounded-2xl shadow-2xl">
                  <div className="flex items-center justify-between border-b border-line px-4 py-3">
                    <span className="text-sm font-semibold">{t("Notifications")}</span>
                    {unread > 0 && (
                      <button className="text-xs text-accent" onClick={() => start(() => markNotificationsRead())}>
                        {t("Mark all read")}
                      </button>
                    )}
                  </div>
                  <ul className="max-h-96 overflow-y-auto">
                    {notices.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted">{t("No notifications")}</li>}
                    {notices.map((n) => (
                      <li key={n.id} className="border-b border-line last:border-0">
                        <Link
                          href={n.link ?? "#"}
                          onClick={() => {
                            setBell(false);
                            if (!n.read) start(() => markNotificationsRead(n.id));
                          }}
                          className={clsx("flex gap-3 px-4 py-3 transition hover:bg-surface-2", !n.read && "notice-unread")}
                        >
                          <span className="notice-icon">{n.link?.includes("leave") ? <Palmtree className="size-4" /> : n.link?.includes("correction") ? <FileClock className="size-4" /> : <Bell className="size-4" />}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium text-ink">{n.title}</span>
                            {n.body && <span className="block truncate text-xs text-muted">{n.body}</span>}
                          </span>
                          <span className="shrink-0 text-[10px] text-muted">{mountedAt === null ? "" : timeAgo(n.created_at, mountedAt, lang)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </div>
          <form action={logout}>
            <button className="btn btn-ghost btn-sm" title={t("Sign out")} aria-label={t("Sign out")}>
              <LogOut className="size-4 rtl:rotate-180" />
            </button>
          </form>
        </header>
        <main id="main-content" tabIndex={-1} className="app-main mx-auto w-full max-w-[1600px] flex-1 px-4 sm:px-6 lg:px-8"><div key={path} className="route-content rise">{children}</div></main>
      </div>

      {palette && <CommandPalette nav={nav} onClose={() => setPalette(false)} onTheme={toggleTheme} onLang={toggleLang} />}
    </div>
  );
}

function CommandPalette({ nav, onClose, onTheme, onLang }: { nav: NavItem[]; onClose: () => void; onTheme: () => void; onLang: () => void }) {
  const { t } = usePrefs();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => { document.getElementById(`command-${idx}`)?.scrollIntoView({ block: "nearest" }); }, [idx]);

  const items = useMemo(() => {
    const base = [
      ...nav.map((n) => ({ id: n.href, label: t(n.label), group: n.group, hint: n.href, icon: ICONS[n.icon], run: () => router.push(n.href) })),
      { id: "profile", group: "Quick actions", label: t("Profile"), hint: "/profile", icon: UserRound, run: () => router.push("/profile") },
      { id: "apply-leave", group: "Quick actions", label: t("Apply for leave"), hint: "/leave", icon: Palmtree, run: () => router.push("/leave#apply") },
      { id: "correction", group: "Quick actions", label: t("Request correction"), hint: "/corrections", icon: FileClock, run: () => router.push("/corrections#apply") },
      { id: "theme", group: "Quick actions", label: t("Theme"), hint: "Dark / Light", icon: Moon, run: onTheme },
      { id: "lang", group: "Quick actions", label: t("Language"), hint: "English / اردو", icon: Globe, run: onLang },
      { id: "logout", group: "Quick actions", label: t("Sign out"), hint: "", icon: LogOut, run: () => logout() },
    ];
    const s = q.trim().toLowerCase();
    return s ? base.filter((i) => i.label.toLowerCase().includes(s) || i.hint.toLowerCase().includes(s)) : base;
  }, [q, nav, t, router, onTheme, onLang]);

  const choose = (i: number) => {
    const it = items[i];
    if (!it) return;
    onClose();
    it.run();
  };

  return (
    <Dialog label={t("Command palette")} onClose={onClose} className="command-palette">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Command className="size-4 text-accent" />
          <input
            ref={input}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setIdx(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIdx((i) => Math.max(0, Math.min(items.length - 1, i + 1)));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIdx((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") choose(idx);
            }}
            placeholder={t("Type a command or search…")}
            aria-label={t("Search")} aria-controls="command-results" aria-activedescendant={`command-${idx}`} role="combobox" aria-expanded="true" autoComplete="off" className="h-14 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
          />
          <button onClick={onClose} aria-label={t("Close")}>
            <X className="size-4 text-muted" />
          </button>
        </div>
        <ul id="command-results" role="listbox" className="max-h-[55vh] overflow-y-auto p-2">
          {items.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">{t("No records")}</li>}
          {items.map((it, i) => {
            const I = it.icon;
            return (
              <li key={it.id} role="presentation">
                {(i === 0 || items[i - 1].group !== it.group) && <div className="command-group">{t(it.group)}</div>}
                <button
                  id={`command-${i}`} role="option" aria-selected={i === idx} tabIndex={-1}
                  onMouseEnter={() => setIdx(i)}
                  onClick={() => choose(i)}
                  className={clsx("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-start text-sm", i === idx ? "bg-accent-soft text-ink" : "text-ink-2")}
                >
                  <I className="size-4 text-muted" />
                  <span className="flex-1">{it.label}</span>
                  <span className="hidden font-mono text-[11px] text-muted sm:inline">{it.hint}</span>
                  {i === idx && <CornerDownLeft className="size-3.5 text-accent" />}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="command-footer"><span>↑ ↓ {t("Navigate")}</span><span>↵ {t("Open")}</span><span className="ms-auto">Esc {t("Close")}</span></div>
    </Dialog>
  );
}

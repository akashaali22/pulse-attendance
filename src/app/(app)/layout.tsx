import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { usesDefaultPassword } from "@/lib/passwords";
import { demoMode } from "@/lib/demo";
import { all, getSetting } from "@/lib/db";
import { pendingApprovalsCount } from "@/lib/data";
import { Shell, type NavItem, type Notice } from "@/components/shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await requireUser();
  const pending = pendingApprovalsCount(me);
  const notices = all<Notice>(
    "SELECT id, title, body, link, read, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 25",
    me.id,
  );
  const mgr = me.role !== "employee";
  const admin = me.role === "admin";

  const nav: NavItem[] = [
    { href: "/dashboard", label: "Dashboard", icon: "dashboard", group: "Workspace" },
    { href: "/attendance", label: "My Attendance", icon: "calendar", group: "Workspace" },
    { href: "/leave", label: "Leave", icon: "leave", group: "Workspace" },
    { href: "/corrections", label: "Corrections", icon: "corrections", group: "Workspace" },
    ...(mgr
      ? ([
          { href: "/team", label: "Team Live", icon: "team", group: "Manage" },
          { href: "/approvals", label: "Approvals", icon: "approvals", group: "Manage", badge: pending },
          { href: "/reports", label: "Reports", icon: "reports", group: "Manage" },
          { href: "/kiosk", label: "QR Kiosk", icon: "qr", group: "Manage" },
          ...(me.role === "manager" ? [{ href: "/employees", label: "My Team", icon: "employees", group: "Manage" } as NavItem] : []),
        ] as NavItem[])
      : []),
    ...(admin
      ? ([
          { href: "/employees", label: "Employees", icon: "employees", group: "Admin" },
          { href: "/settings", label: "Settings", icon: "settings", group: "Admin" },
          { href: "/audit", label: "Audit Log", icon: "audit", group: "Admin" },
        ] as NavItem[])
      : []),
  ];

  return (
    <Shell
      nav={nav}
      notices={notices}
      company={getSetting("company_name", "My Company")}
      user={{ name: me.name, email: me.email, role: me.role, designation: me.designation }}
    >
      {demoMode() && (
        <div className="mb-4 rounded-2xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm text-ink">
          <strong>Demo.</strong> Sample data, and everything resets when the server restarts. Run your own copy from{" "}
          <a href="https://github.com/akashaali98/pulse-attendance" className="text-accent underline" target="_blank" rel="noreferrer">
            GitHub
          </a>
          .
        </div>
      )}
      {(await usesDefaultPassword(me.id)) && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-bad/40 bg-bad/10 px-4 py-3 text-sm">
          <ShieldAlert className="size-5 shrink-0 text-bad" />
          <span className="flex-1 text-ink">
            <strong>You are still using the default password.</strong> Anyone who knows this software can sign in as you.
          </span>
          <Link href="/profile" className="btn btn-sm bg-bad text-white">
            Change it now
          </Link>
        </div>
      )}
      {children}
    </Shell>
  );
}

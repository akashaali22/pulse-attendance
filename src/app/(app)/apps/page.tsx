import type { Metadata } from "next";
import { headers } from "next/headers";
import { Apple, Download, Laptop, Smartphone } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getPrefs } from "@/lib/prefs";
import { Card, PageHeader } from "@/components/ui";
import { CopyBox } from "./copy-box";

export const metadata: Metadata = { title: "Get the app" };
export const dynamic = "force-dynamic";

export default async function AppsPage() {
  const me = await requireUser();
  const { t } = await getPrefs();
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${proto}://${host}`;
  const secure = proto === "https" || host.startsWith("localhost");

  return (
    <>
      <PageHeader
        title={t("Get the app")}
        subtitle={t("Install it once and your attendance is recorded automatically")}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* ── Windows ── */}
        <Card
          title={
            <span className="flex items-center gap-2">
              <Laptop className="size-4 text-accent" /> Windows PC
            </span>
          }
        >
          <div className="space-y-4 p-5 text-sm text-ink-2">
            <p className="text-ink">Records attendance by itself — nothing to press.</p>
            <a href="/api/agent/download" className="btn btn-primary w-full" download>
              <Download className="size-4" /> Download PulseAgent.exe
            </a>
            <ol className="list-decimal space-y-1.5 ps-5">
              <li>Run the file. Windows may warn about an unknown publisher — choose <em>More info → Run anyway</em>.</li>
              <li>
                Server address: <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs">{origin}</code>
              </li>
              <li>Sign in with your own email and password. That is the only time you type it.</li>
            </ol>
            <p className="text-xs text-muted">Needs nothing installed — it uses what already ships with Windows 10 and 11.</p>
          </div>
        </Card>

        {/* ── macOS ── */}
        <Card
          title={
            <span className="flex items-center gap-2">
              <Apple className="size-4 text-accent" /> Mac
            </span>
          }
        >
          <div className="space-y-4 p-5 text-sm text-ink-2">
            <p className="text-ink">Same thing for macOS. Paste one line into Terminal.</p>
            <CopyBox text={`curl -fsSL ${origin}/api/agent/download/mac | bash`} />
            <ol className="list-decimal space-y-1.5 ps-5">
              <li>Open <strong>Terminal</strong> (Command + Space, type “Terminal”).</li>
              <li>Paste the line above and press Return.</li>
              <li>Sign in with your email and password when asked.</li>
            </ol>
            <p className="text-xs text-muted">
              Installs for your account only — no admin password needed. It starts at every login and keeps your device
              token in the Mac’s Keychain.
            </p>
          </div>
        </Card>

        {/* ── Phone ── */}
        <Card
          title={
            <span className="flex items-center gap-2">
              <Smartphone className="size-4 text-accent" /> Phone
            </span>
          }
        >
          <div className="space-y-4 p-5 text-sm text-ink-2">
            <p className="text-ink">Install this site as an app for check-in on the move.</p>
            <div className="rounded-xl border border-line p-3">
              <div className="font-semibold text-ink">iPhone / iPad</div>
              <ol className="mt-1 list-decimal space-y-1 ps-5 text-xs">
                <li>Open <code className="font-mono">{host}</code> in <strong>Safari</strong></li>
                <li>Tap <strong>Share</strong> (the square with the arrow)</li>
                <li>Tap <strong>Add to Home Screen</strong></li>
              </ol>
            </div>
            <div className="rounded-xl border border-line p-3">
              <div className="font-semibold text-ink">Android</div>
              <ol className="mt-1 list-decimal space-y-1 ps-5 text-xs">
                <li>Open <code className="font-mono">{host}</code> in <strong>Chrome</strong></li>
                <li>Menu (⋮) → <strong>Install app</strong></li>
              </ol>
            </div>
            <p className="text-xs text-muted">
              On a phone, attendance is <strong>not</strong> automatic: you press Check In. Phones stop apps in the
              background, so nothing can record attendance on its own there.
              {!secure && " Camera and GPS also need the site to be served over HTTPS."}
            </p>
          </div>
        </Card>
      </div>

      <Card className="mt-4" title={t("What the desktop agent does")}>
        <div className="overflow-x-auto">
          <table className="data">
            <thead>
              <tr>
                <th>{t("On your computer")}</th>
                <th>{t("Recorded as")}</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Log in / unlock / wake up", "Check-in"],
                ["Lock the screen for longer than the away limit", "Checked out at the moment you locked it"],
                ["Sleep, log off or shut down", "Check-out"],
                ["Power cut or crash", "Checked out at the last signal the server received"],
                ["No internet", "Saved on the computer and sent later, with the original time"],
              ].map(([a, b]) => (
                <tr key={a}>
                  <td className="text-ink">{a}</td>
                  <td>{b}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-5 py-3 text-xs text-muted">
          Signed in as {me.name}. The agent only sends your own attendance — it cannot read anyone else’s data, and an
          admin can unlink any computer at any time.
        </p>
      </Card>
    </>
  );
}

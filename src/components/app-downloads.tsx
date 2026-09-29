import { Apple, Download, Laptop, Smartphone } from "lucide-react";
import type { T } from "@/lib/i18n";
import { Card } from "@/components/ui";
import { CopyBox } from "@/app/(app)/apps/copy-box";

export type Os = "windows" | "mac" | "phone";

/** Best guess from the browser's user agent, so the visitor's own platform comes first. */
export function detectOs(ua: string): Os {
  const s = ua.toLowerCase();
  if (/android|iphone|ipad|ipod/.test(s)) return "phone";
  if (/mac os x|macintosh/.test(s)) return "mac";
  return "windows";
}

function Windows() {
  return (
    <div className="space-y-4 p-5 text-sm text-ink-2">
      <p className="text-ink">Records attendance by itself — nothing to press.</p>
      <a href="/api/agent/download" className="btn btn-primary w-full" download>
        <Download className="size-4" /> Download PulseAgent.exe
      </a>
      <ol className="list-decimal space-y-1.5 ps-5">
        <li>Run the file. Windows may warn about an unknown publisher — choose <em>More info → Run anyway</em>.</li>
        <li>The app opens your browser. Choose <strong>Continue as your name</strong> to connect.</li>
        <li>Already signed in? No password is needed. The company connection is configured automatically.</li>
      </ol>
      <p className="text-xs text-muted">Needs nothing installed — it uses what already ships with Windows 10 and 11.</p>
    </div>
  );
}

function Mac({ origin }: { origin: string }) {
  return (
    <div className="space-y-4 p-5 text-sm text-ink-2">
      <p className="text-ink">Records attendance by itself — nothing to press.</p>
      <a href="/api/agent/download/mac-dmg" className="btn btn-primary w-full" download>
        <Download className="size-4" /> Download PulseAgent.dmg
      </a>
      <ol className="list-decimal space-y-1.5 ps-5">
        <li>Open the file and drag <strong>Pulse Attendance</strong> into <strong>Applications</strong>.</li>
        <li>The app opens your browser. Choose <strong>Continue as your name</strong> to connect.</li>
        <li>Already signed in? No password is needed. The company connection is configured automatically.</li>
      </ol>

      {/* Every Mac shows this once, because the app is not notarised by Apple. Saying so plainly,
          before it happens, is what stops people thinking they have downloaded something harmful. */}
      <div className="rounded-xl border border-warn/40 bg-warn/5 p-3">
        <div className="text-xs font-semibold text-ink">The first time, macOS will stop it once — this is normal</div>
        <p className="mt-1 text-xs">
          You will see <em>“Pulse Attendance” Not Opened — Apple could not verify this app is free of malware</em>.
          Every app that is not signed with a paid Apple developer account shows this. Nothing is wrong with the file.
          Allow it once:
        </p>
        <ol className="mt-2 list-decimal space-y-1.5 ps-5 text-xs">
          <li>Press <strong>Done</strong> on that message. <strong>Not</strong> “Move to Trash”.</li>
          <li>Open <strong>System Settings</strong> → <strong>Privacy &amp; Security</strong> and scroll to the bottom.</li>
          <li>
            It says <em>“Pulse Attendance” was blocked to protect your Mac</em> — press <strong>Open Anyway</strong>.
          </li>
          <li>Give your Touch ID or Mac password, then press <strong>Open Anyway</strong> once more.</li>
        </ol>
        <p className="mt-2 text-xs text-muted">
          That is a one-time step. From then on the app opens with a plain double-click, like any other.
          If the button is not there, open the app again so the message appears, then look in Settings.
        </p>
      </div>

      <details className="rounded-xl border border-line p-3">
        <summary className="cursor-pointer text-xs font-medium text-ink">Ways to skip that step entirely</summary>
        <div className="mt-3 space-y-3 text-xs">
          <div>
            <div className="font-semibold text-ink">One line in Terminal</div>
            <p className="mt-1">Installs the same agent with no app bundle, so macOS never asks anything.</p>
            <div className="mt-2">
              <CopyBox text={`curl -fsSL ${origin}/api/agent/download/mac | bash`} />
            </div>
          </div>
          <div>
            <div className="font-semibold text-ink">Bring the file in on a USB stick</div>
            <p className="mt-1">
              The block comes from a flag browsers, AirDrop and mail attach to anything they bring in. Copy
              PulseAgent.dmg onto a USB stick from another computer, or take it from a shared network folder, and it
              opens with a plain double-click.
            </p>
          </div>
        </div>
      </details>

      <p className="text-xs text-muted">
        Installs for your account only — no admin password needed. It starts at every login and keeps your device token
        in the Mac’s Keychain.
      </p>
    </div>
  );
}

function Phone({ host, secure }: { host: string; secure: boolean }) {
  return (
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
  );
}

/** The three ways to get the app, the visitor's own platform first. */
export function AppDownloads({ origin, host, secure, first }: { origin: string; host: string; secure: boolean; first: Os }) {
  const cards: Record<Os, { icon: React.ReactNode; title: string; body: React.ReactNode }> = {
    windows: { icon: <Laptop className="size-4 text-accent" />, title: "Windows PC", body: <Windows /> },
    mac: { icon: <Apple className="size-4 text-accent" />, title: "Mac", body: <Mac origin={origin} /> },
    phone: { icon: <Smartphone className="size-4 text-accent" />, title: "Phone", body: <Phone host={host} secure={secure} /> },
  };
  const order: Os[] = [first, ...(["windows", "mac", "phone"] as Os[]).filter((o) => o !== first)];

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      {order.map((os, i) => (
        <Card
          key={os}
          className={i === 0 ? "border-accent/40" : undefined}
          title={
            <span className="flex items-center gap-2">
              {cards[os].icon} {cards[os].title}
              {i === 0 && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent">Your device</span>}
            </span>
          }
        >
          {cards[os].body}
        </Card>
      ))}
    </div>
  );
}

/** What the desktop agent records, in plain words. */
export function AgentBehaviour({ t, footer }: { t: T; footer?: React.ReactNode }) {
  return (
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
      {footer && <p className="px-5 py-3 text-xs text-muted">{footer}</p>}
    </Card>
  );
}
